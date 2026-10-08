using System.Diagnostics;
using System.Text.Json;
using Xunit;

namespace DataPadPlusPlus.LiteDbSidecar.Tests;

public sealed class LiteDbSidecarTests
{
    [Fact]
    public async Task Explorer_metadata_reads_real_collections_indexes_counts_and_pragmas_without_writing()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var databasePath = Path.Combine(root, "metadata.db");
            await SeedAsync(databasePath, new { _id = 1, name = "café 日本語" }, new { _id = 2, amount = 5.25m });
            using var indexed = await InvokeAsync(Envelope(databasePath, "EnsureIndex", false,
                new { collection = "items", name = "amount_idx", expression = "$.amount", unique = false }));
            Assert.True(indexed.RootElement.GetProperty("ok").GetBoolean());
            var before = await File.ReadAllBytesAsync(databasePath);
            using var result = await InvokeAsync(Envelope(databasePath, "GetMetadata", true, new { }));
            Assert.True(result.RootElement.GetProperty("ok").GetBoolean(), result.RootElement.GetRawText());
            var data = result.RootElement.GetProperty("response");
            Assert.Equal(1, data.GetProperty("collectionCount").GetInt32());
            Assert.Equal(2, data.GetProperty("documentCount").GetInt32());
            Assert.Equal(3, data.GetProperty("indexCount").GetInt32()); // _id, fixture category, and amount_idx
            Assert.Equal("items", data.GetProperty("collections")[0].GetProperty("name").GetString());
            Assert.Equal(6, data.GetProperty("pragmas").GetArrayLength());
            using var allIndexes = await InvokeAsync(Envelope(databasePath, "ListIndexes", true, new { }));
            Assert.Equal(3, allIndexes.RootElement.GetProperty("response").GetProperty("indexes").GetArrayLength());
            using var missing = await InvokeAsync(Envelope(databasePath, "GetMetadata", true, new { collection = "removed" }));
            Assert.Equal("litedb-collection-missing", missing.RootElement.GetProperty("code").GetString());
            Assert.Equal(before, await File.ReadAllBytesAsync(databasePath));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Theory]
    [InlineData("ListCollections")]
    [InlineData("ListIndexes")]
    [InlineData("GetMetadata")]
    public async Task Explorer_does_not_silently_create_missing_databases(string operation)
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var databasePath = Path.Combine(root, "missing.db");
            using var response = await InvokeAsync(Envelope(databasePath, operation, true, new { }));
            Assert.Equal("litedb-file-missing", response.RootElement.GetProperty("code").GetString());
            Assert.False(File.Exists(databasePath));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Large_json_import_and_guarded_edit_use_native_document_limits()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var databasePath = Path.Combine(root, "large.db");
            var sourcePath = Path.Combine(root, "large.json");
            var payload = new string('\u0001', 3 * 1024 * 1024);
            var original = new { _id = 1, payload };
            await File.WriteAllTextAsync(sourcePath, JsonSerializer.Serialize(original));
            Assert.True(new FileInfo(sourcePath).Length > 16 * 1024 * 1024);
            await SeedAsync(databasePath);
            using var imported = await InvokeAsync(Envelope(databasePath, "ImportCollection", false,
                new { collection = "items", sourcePath, format = "json", mode = "insert" }));
            Assert.True(imported.RootElement.GetProperty("ok").GetBoolean());
            Assert.Equal(1, imported.RootElement.GetProperty("response").GetProperty("importedCount").GetInt32());

            using var updated = await InvokeAsync(MutationRequest(databasePath,
                new { _id = 1, payload, enabled = true }, original, "enabled"));
            Assert.True(updated.RootElement.GetProperty("ok").GetBoolean());
            var after = updated.RootElement.GetProperty("response").GetProperty("afterDocument");
            Assert.Equal(payload, after.GetProperty("payload").GetString());
            Assert.True(after.GetProperty("enabled").GetBoolean());
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("exact password ; Unicode Ω")]
    public async Task Create_initializes_a_real_database_and_never_overwrites(string? password)
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var databasePath = Path.Combine(root, "created.db");
            object Request(string operation, bool readOnly) => new {
                engine = "litedb", protocolVersion = 1, databasePath, password,
                operation, request = new { }, rowLimit = 1, readOnly
            };
            using var created = await InvokeAsync(Request("CreateDatabase", false));
            Assert.True(created.RootElement.GetProperty("ok").GetBoolean(), created.RootElement.GetRawText());
            Assert.True(new FileInfo(databasePath).Length > 0);
            var before = await File.ReadAllBytesAsync(databasePath);
            using var duplicate = await InvokeAsync(Request("CreateDatabase", false));
            Assert.False(duplicate.RootElement.GetProperty("ok").GetBoolean());
            Assert.Equal(before, await File.ReadAllBytesAsync(databasePath));
            using var tested = await InvokeAsync(Request("TestConnection", true));
            Assert.True(tested.RootElement.GetProperty("ok").GetBoolean(), tested.RootElement.GetRawText());
            Assert.Equal(before, await File.ReadAllBytesAsync(databasePath));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Test_does_not_create_a_missing_database()
    {
        var root = CreateTemporaryDirectory();
        try {
            var databasePath = Path.Combine(root, "missing.db");
            using var tested = await InvokeAsync(Envelope(databasePath, "TestConnection", true, new { }));
            Assert.False(tested.RootElement.GetProperty("ok").GetBoolean());
            Assert.False(File.Exists(databasePath));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Protocol_validation_returns_typed_sanitized_errors()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var databasePath = Path.Combine(root, "private-database-name.db");
            const string password = "never-echo-this-password";
            using var result = await InvokeAsync(new
            {
                engine = "not-litedb",
                protocolVersion = 1,
                databasePath,
                password,
                operation = "ListCollections",
                request = new { },
                rowLimit = 50,
                readOnly = true
            });

            Assert.False(result.RootElement.GetProperty("ok").GetBoolean());
            Assert.Equal("litedb-invalid-engine", result.RootElement.GetProperty("code").GetString());
            var serialized = result.RootElement.GetRawText();
            Assert.DoesNotContain(databasePath, serialized, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(password, serialized, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Document_mutations_preserve_native_values_and_guard_add_field()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var databasePath = Path.Combine(root, "mutations.db");
            var original = new
            {
                _id = 1,
                name = "alpha",
                updatedAt = new Dictionary<string, object> { ["$date"] = "2026-08-08T09:10:11.123Z" },
                correlationId = new Dictionary<string, object> { ["$guid"] = "9e107d9d-372b-4f7d-bb3a-17d63746f9a0" }
            };
            await SeedAsync(databasePath, original);

            using var added = await InvokeAsync(MutationRequest(databasePath, new
            {
                _id = 1,
                name = "alpha",
                updatedAt = new Dictionary<string, object> { ["$date"] = "2026-08-08T09:10:11.123Z" },
                correlationId = new Dictionary<string, object> { ["$guid"] = "9e107d9d-372b-4f7d-bb3a-17d63746f9a0" },
                enabled = true
            }, original, "enabled"));

            Assert.True(added.RootElement.GetProperty("ok").GetBoolean());
            var after = added.RootElement.GetProperty("response").GetProperty("afterDocument");
            Assert.True(after.GetProperty("enabled").GetBoolean());
            Assert.Equal("9e107d9d-372b-4f7d-bb3a-17d63746f9a0", after.GetProperty("correlationId").GetProperty("$guid").GetString());

            using var rejected = await InvokeAsync(MutationRequest(databasePath, new
            {
                _id = 1,
                name = "replacement"
            }, previousDocument: null, path: "name"));

            Assert.False(rejected.RootElement.GetProperty("ok").GetBoolean());
            Assert.Equal("litedb-field-exists", rejected.RootElement.GetProperty("code").GetString());
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Collection_export_and_import_round_trip_through_the_protocol()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var sourceDatabase = Path.Combine(root, "source.db");
            var targetDatabase = Path.Combine(root, "target.db");
            var exportPath = Path.Combine(root, "items.ndjson");
            await SeedAsync(sourceDatabase,
                new { _id = 1, name = "first", amount = 12.5m },
                new { _id = 2, name = "second", nested = new { active = true } });
            await SeedAsync(targetDatabase);

            using var exported = await InvokeAsync(Envelope(sourceDatabase, "ExportCollection", true, new
            {
                collection = "items",
                targetPath = exportPath,
                format = "ndjson"
            }));
            Assert.True(exported.RootElement.GetProperty("ok").GetBoolean());
            Assert.Equal(2, exported.RootElement.GetProperty("response").GetProperty("exportedCount").GetInt32());
            Assert.True(File.Exists(exportPath));

            using var imported = await InvokeAsync(Envelope(targetDatabase, "ImportCollection", false, new
            {
                collection = "items",
                sourcePath = exportPath,
                format = "ndjson",
                mode = "insert"
            }));
            Assert.True(imported.RootElement.GetProperty("ok").GetBoolean());
            Assert.Equal(2, imported.RootElement.GetProperty("response").GetProperty("importedCount").GetInt32());

            using var count = await InvokeAsync(Envelope(targetDatabase, "Count", true, new { collection = "items" }));
            Assert.Equal(2, count.RootElement.GetProperty("response").GetProperty("count").GetInt32());
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Find_and_count_apply_native_filters_grouping_sort_skip_and_parameters()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var file = Path.Combine(root, "queries.db");
            await SeedAsync(file,
                new { _id = 1, age = 10, status = "active", name = "Alice" },
                new { _id = 2, age = 20, status = "active", name = "Alan" },
                new { _id = 3, age = 30, status = "paused", name = "Bob" },
                new { _id = 4, age = 40, status = "closed", name = "Carol" });
            var filter = "($.[\"age\"] >= @p0) AND (($.[\"status\"] = @p1) OR ($.[\"status\"] = @p2))";
            var parameters = new { p0 = 20, p1 = "active", p2 = "paused" };
            using var found = await InvokeAsync(Envelope(file, "Find", true, new {
                collection = "items", filter, parameters,
                orderBy = new { expression = "$.[\"age\"]", direction = "desc" }, skip = 1, limit = 1
            }));
            Assert.True(found.RootElement.GetProperty("ok").GetBoolean(), found.RootElement.GetRawText());
            Assert.Equal(2, found.RootElement.GetProperty("response").GetProperty("documents")[0].GetProperty("_id").GetInt32());
            using var counted = await InvokeAsync(Envelope(file, "Count", true, new { collection = "items", filter, parameters }));
            Assert.Equal(2, counted.RootElement.GetProperty("response").GetProperty("count").GetInt64());
            using var equal = await InvokeAsync(Envelope(file, "Find", true, new { collection = "items", filter = new { age = 30 } }));
            Assert.Single(equal.RootElement.GetProperty("response").GetProperty("documents").EnumerateArray());
            foreach (var expression in new[] { "INDEXOF($.[\"name\"], @p0) = 0", "$.[\"name\"] IN @p1", "($.[\"name\"] IN @p2) = false" })
            {
                using var result = await InvokeAsync(Envelope(file, "Count", true, new { collection = "items", filter = expression, parameters = new { p0 = "Al", p1 = new[] { "Alice", "Alan" }, p2 = new[] { "Bob", "Carol" } } }));
                Assert.True(result.RootElement.GetProperty("ok").GetBoolean(), result.RootElement.GetRawText());
                Assert.Equal(2, result.RootElement.GetProperty("response").GetProperty("count").GetInt64());
            }
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Native_array_predicates_never_match_missing_null_or_scalar_values()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var file = Path.Combine(root, "arrays.db");
            await SeedAsync(file, new { _id = 1, values = Array.Empty<int>() }, new { _id = 2, values = new[] { 1, 2 } },
                new { _id = 3 }, new { _id = 4, values = (object?)null }, new { _id = 5, values = "abc" }, new { _id = 6, values = 5 });
            foreach (var comparison in new[] { "= 0", "> 0", "= @p0" })
            {
                using var result = await InvokeAsync(Envelope(file, "Count", true, new { collection = "items", filter = $"(IS_ARRAY($.[\"values\"]) = true AND COUNT($.[\"values\"]) {comparison})", parameters = new { p0 = 2 } }));
                Assert.True(result.RootElement.GetProperty("ok").GetBoolean(), result.RootElement.GetRawText());
                Assert.Equal(1, result.RootElement.GetProperty("response").GetProperty("count").GetInt64());
            }
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Native_query_parameters_preserve_extended_json_and_cannot_inject_predicates()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var file = Path.Combine(root, "types.db");
            var date = new Dictionary<string, object> { ["$date"] = "2026-10-08T10:30:00.000Z" };
            var guid = new Dictionary<string, object> { ["$guid"] = "9e107d9d-372b-4f7d-bb3a-17d63746f9a0" };
            var oid = new Dictionary<string, object> { ["$oid"] = "507f1f77bcf86cd799439011" };
            await SeedAsync(file, new { _id = 1, date, guid, oid, name = "' OR true --", nested = new { active = true } }, new { _id = 2, name = "safe" });
            foreach (var entry in new Dictionary<string, object> { ["date"] = date, ["guid"] = guid, ["oid"] = oid, ["name"] = "' OR true --", ["nested.active"] = true })
            {
                var expression = "$" + string.Concat(entry.Key.Split('.').Select(part => ".[\"" + part + "\"]")) + " = @p0";
                using var result = await InvokeAsync(Envelope(file, "Count", true, new { collection = "items", filter = expression, parameters = new { p0 = entry.Value } }));
                Assert.True(result.RootElement.GetProperty("ok").GetBoolean(), result.RootElement.GetRawText());
                Assert.Equal(1, result.RootElement.GetProperty("response").GetProperty("count").GetInt64());
            }
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Invalid_filters_and_missing_collections_fail_instead_of_returning_unfiltered_data()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var file = Path.Combine(root, "invalid.db");
            await SeedAsync(file, new { _id = 1 });
            foreach (var request in new object[] {
                new { collection = "items", filter = 5 }, new { collection = "items", filter = "bad syntax ('" },
                new { collection = "items", filter = new Dictionary<string, object> { ["$or"] = new[] { 1 } } },
                new { collection = "items", skip = -1 }, new { collection = "items", orderBy = new { expression = "_id", direction = "wrong" } },
                new { collection = "missing" }
            })
            {
                using var result = await InvokeAsync(Envelope(file, "Find", true, request));
                Assert.False(result.RootElement.GetProperty("ok").GetBoolean());
            }
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    private static object MutationRequest(string databasePath, object document, object? previousDocument, string path) =>
        Envelope(databasePath, "UpdateDocument", false, new
        {
            collection = "items",
            id = 1,
            document,
            previousDocument,
            editKind = "add-field",
            path = new[] { path }
        });

    private static async Task SeedAsync(string databasePath, params object[] documents)
    {
        using var seeded = await InvokeAsync(
            Envelope(databasePath, "SeedFixture", false, new { collection = "items", documents }),
            allowFixtureSeed: true);
        Assert.True(seeded.RootElement.GetProperty("ok").GetBoolean(), seeded.RootElement.GetRawText());
    }

    private static object Envelope(string databasePath, string operation, bool readOnly, object request) => new
    {
        engine = "litedb",
        protocolVersion = 1,
        databasePath,
        operation,
        request,
        rowLimit = 50,
        readOnly
    };

    private static async Task<JsonDocument> InvokeAsync(object request, bool allowFixtureSeed = false)
    {
        var sidecarAssembly = typeof(SidecarRequest).Assembly.Location;
        var startInfo = new ProcessStartInfo("dotnet")
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        startInfo.ArgumentList.Add(sidecarAssembly);
        if (allowFixtureSeed)
        {
            startInfo.Environment["DATAPADPLUSPLUS_LITEDB_SIDECAR_ALLOW_FIXTURE_SEED"] = "1";
        }

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Could not start the LiteDB sidecar.");
        await process.StandardInput.WriteAsync(JsonSerializer.Serialize(request));
        process.StandardInput.Close();
        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        var output = await outputTask;
        var error = await errorTask;

        Assert.True(process.ExitCode == 0, $"LiteDB sidecar exited with {process.ExitCode}: {error}");
        Assert.False(string.IsNullOrWhiteSpace(output), $"LiteDB sidecar returned no response: {error}");
        return JsonDocument.Parse(output);
    }

    private static string CreateTemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"datapadplusplus-litedb-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}
