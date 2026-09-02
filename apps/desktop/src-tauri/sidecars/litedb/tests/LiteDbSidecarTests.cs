using System.Diagnostics;
using System.Text.Json;
using Xunit;

namespace DataPadPlusPlus.LiteDbSidecar.Tests;

public sealed class LiteDbSidecarTests
{
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
