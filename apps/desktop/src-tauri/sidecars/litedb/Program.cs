using System.Text.Json;
using LiteDB;

var input = Console.In.ReadToEnd();

try
{
    var envelope = System.Text.Json.JsonSerializer.Deserialize<SidecarRequest>(input, JsonOptions.Default)
        ?? throw new SidecarException("litedb-invalid-request", "LiteDB sidecar request was empty.");

    ValidateEnvelope(envelope);
    var response = Dispatch(envelope);
    WriteOk(response);
}
catch (SidecarException ex)
{
    WriteError(ex.Code, ex.Message);
}
catch (Exception ex)
{
    WriteError("litedb-sidecar-error", ex.Message);
}

static object Dispatch(SidecarRequest envelope)
{
    var operation = envelope.Operation!.Trim();
    var databasePath = envelope.DatabasePath!.Trim();
    var canSeedFixture = operation.Equals("SeedFixture", StringComparison.OrdinalIgnoreCase)
        && Environment.GetEnvironmentVariable("DATAPADPLUSPLUS_LITEDB_SIDECAR_ALLOW_FIXTURE_SEED") == "1";

    if (!canSeedFixture && !File.Exists(databasePath))
    {
        throw new SidecarException("litedb-file-missing", "LiteDB file does not exist.");
    }

    using var db = new LiteDatabase(BuildConnectionString(databasePath, envelope.Password));

    return operation switch
    {
        "ListCollections" => ListCollections(db),
        "Find" or "Query" => Find(db, envelope),
        "FindById" => FindById(db, envelope),
        "Count" => Count(db, envelope),
        "ListIndexes" => ListIndexes(db, envelope),
        "SampleSchema" => SampleSchema(db, envelope),
        "Explain" => Explain(envelope),
        "InsertDocument" => InsertDocument(db, envelope),
        "UpdateDocument" => UpdateDocument(db, envelope),
        "DeleteDocument" => DeleteDocument(db, envelope),
        "SeedFixture" when canSeedFixture => SeedFixture(db, envelope),
        "SeedFixture" => throw new SidecarException(
            "litedb-fixture-seed-disabled",
            "LiteDB fixture seeding is disabled for this sidecar process."),
        _ => throw new SidecarException("litedb-unsupported-operation", "LiteDB sidecar operation is not supported.")
    };
}

static object ListCollections(LiteDatabase db)
{
    var collections = db.GetCollectionNames()
        .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
        .Select(name => new { name })
        .ToArray();

    return new { collections };
}

static object Find(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var collection = db.GetCollection<BsonDocument>(collectionName);
    var limit = EffectiveLimit(envelope);
    var documents = collection.FindAll()
        .Take(limit)
        .Select(BsonToElement)
        .ToArray();

    return new
    {
        collection = collectionName,
        documents,
        hasMore = documents.Length >= limit && limit > envelope.RowLimit,
        scanned = documents.Length
    };
}

static object FindById(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var idElement = RequireProperty(envelope.Request, "id");
    var collection = db.GetCollection<BsonDocument>(collectionName);
    var document = collection.FindById(JsonElementToBson(idElement));

    return new
    {
        collection = collectionName,
        documents = document is null ? Array.Empty<JsonElement>() : new[] { BsonToElement(document) },
        hasMore = false,
        scanned = document is null ? 0 : 1
    };
}

static object Count(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var count = db.GetCollection<BsonDocument>(collectionName).Count();
    return new { collection = collectionName, count };
}

static object ListIndexes(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var indexes = db.Execute("SELECT $ FROM $indexes")
        .ToEnumerable()
        .Where(value => value.IsDocument)
        .Select(value => value.AsDocument)
        .Where(document => string.Equals(BsonString(document, "collection"), collectionName, StringComparison.OrdinalIgnoreCase))
        .Select(document => new
        {
            collection = collectionName,
            name = BsonString(document, "name") ?? "_id",
            expression = BsonString(document, "expression") ?? "$._id",
            unique = BsonBool(document, "unique")
        })
        .ToArray();

    return new { collection = collectionName, indexes };
}

static object SampleSchema(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var sampleSize = Math.Min(EffectiveLimit(envelope), 25);
    var fields = new SortedDictionary<string, SortedSet<string>>(StringComparer.OrdinalIgnoreCase);

    foreach (var document in db.GetCollection<BsonDocument>(collectionName).FindAll().Take(sampleSize))
    {
        CollectFields(document, fields, prefix: "");
    }

    return new
    {
        collection = collectionName,
        sampleSize,
        fields = fields.Select(field => new
        {
            path = field.Key,
            types = field.Value.OrderBy(type => type, StringComparer.OrdinalIgnoreCase).ToArray()
        }).ToArray()
    };
}

static object Explain(SidecarRequest envelope)
{
    var collectionName = OptionalCollection(envelope.Request);

    return new
    {
        collection = collectionName,
        engine = "litedb",
        mode = "sidecar",
        operation = envelope.Operation,
        profile = new[]
        {
            "LiteDB does not expose a wire-level EXPLAIN plan through the embedded API.",
            "DataPad++ captures operation type, limit, and sidecar dispatch evidence for this native diagnostics surface."
        },
        limit = EffectiveLimit(envelope)
    };
}

static object InsertDocument(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var document = RequireDocument(envelope.Request, "document", "litedb-invalid-document");
    var requestId = OptionalProperty(envelope.Request, "id") is { } idElement
        ? JsonElementToBson(idElement)
        : null;

    if (requestId is not null)
    {
        if (TryDocumentId(document, out var documentId) && !BsonValuesEqual(documentId, requestId))
        {
            throw new SidecarException("litedb-id-mismatch", "LiteDB inserted document `_id` cannot differ from the requested id.");
        }

        if (!TryDocumentId(document, out _))
        {
            document["_id"] = requestId;
        }
    }

    if (!TryDocumentId(document, out var insertedId))
    {
        throw new SidecarException("litedb-missing-id", "LiteDB document insert requires `_id` so after-read evidence can be captured.");
    }

    var collection = db.GetCollection<BsonDocument>(collectionName);
    var returnedId = collection.Insert(document);
    var after = collection.FindById(insertedId);

    return new
    {
        collection = collectionName,
        operation = "InsertDocument",
        insertedId = BsonToElement(returnedId),
        insertedCount = 1,
        documents = after is null ? Array.Empty<JsonElement>() : new[] { BsonToElement(after) },
        afterDocument = BsonToNullableElement(after),
        evidence = new
        {
            before = (object?)null,
            after = new { operation = "FindById", matched = after is not null },
            engineRuntimeValidated = true,
            mutationExecutionValidated = true
        }
    };
}

static object UpdateDocument(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var id = JsonElementToBson(RequireProperty(envelope.Request, "id"));
    var document = RequireDocument(envelope.Request, "document", "litedb-invalid-document");

    if (TryDocumentId(document, out var replacementId) && !BsonValuesEqual(replacementId, id))
    {
        throw new SidecarException("litedb-id-mismatch", "LiteDB replacement document cannot change `_id`.");
    }

    if (!TryDocumentId(document, out _))
    {
        document["_id"] = id;
    }

    var collection = db.GetCollection<BsonDocument>(collectionName);
    var before = collection.FindById(id);
    var modified = before is not null && collection.Update(document);
    var after = collection.FindById(id);

    return new
    {
        collection = collectionName,
        operation = "UpdateDocument",
        matchedCount = before is null ? 0 : 1,
        modifiedCount = modified ? 1 : 0,
        documents = after is null ? Array.Empty<JsonElement>() : new[] { BsonToElement(after) },
        beforeDocument = BsonToNullableElement(before),
        afterDocument = BsonToNullableElement(after),
        evidence = new
        {
            before = new { operation = "FindById", matched = before is not null },
            after = new { operation = "FindById", matched = after is not null },
            engineRuntimeValidated = true,
            mutationExecutionValidated = modified
        }
    };
}

static object DeleteDocument(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var id = JsonElementToBson(RequireProperty(envelope.Request, "id"));
    var collection = db.GetCollection<BsonDocument>(collectionName);
    var before = collection.FindById(id);
    var deleted = collection.Delete(id);
    var after = collection.FindById(id);

    return new
    {
        collection = collectionName,
        operation = "DeleteDocument",
        deletedCount = deleted ? 1 : 0,
        documents = Array.Empty<JsonElement>(),
        beforeDocument = BsonToNullableElement(before),
        afterDocument = BsonToNullableElement(after),
        evidence = new
        {
            before = new { operation = "FindById", matched = before is not null },
            after = new { operation = "FindById", matched = after is not null },
            engineRuntimeValidated = true,
            mutationExecutionValidated = deleted
        }
    };
}

static object SeedFixture(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var documentsElement = RequireProperty(envelope.Request, "documents");
    if (documentsElement.ValueKind != JsonValueKind.Array)
    {
        throw new SidecarException("litedb-invalid-fixture", "LiteDB fixture documents must be an array.");
    }

    var collection = db.GetCollection<BsonDocument>(collectionName);
    collection.DeleteAll();

    var inserted = 0;
    foreach (var documentElement in documentsElement.EnumerateArray())
    {
        var bsonValue = LiteDB.JsonSerializer.Deserialize(documentElement.GetRawText());
        if (!bsonValue.IsDocument)
        {
            throw new SidecarException("litedb-invalid-fixture", "LiteDB fixture document must be a JSON object.");
        }

        collection.Insert(bsonValue.AsDocument);
        inserted++;
    }

    collection.EnsureIndex("category", false);

    return new { collection = collectionName, inserted };
}

static void ValidateEnvelope(SidecarRequest envelope)
{
    if (!string.Equals(envelope.Engine, "litedb", StringComparison.OrdinalIgnoreCase))
    {
        throw new SidecarException("litedb-invalid-engine", "LiteDB sidecar request engine must be litedb.");
    }

    if (envelope.ProtocolVersion != 1)
    {
        throw new SidecarException("litedb-protocol-version", "LiteDB sidecar protocol version is not supported.");
    }

    if (string.IsNullOrWhiteSpace(envelope.DatabasePath))
    {
        throw new SidecarException("litedb-missing-path", "LiteDB sidecar request requires a database path.");
    }

    if (string.IsNullOrWhiteSpace(envelope.Operation))
    {
        throw new SidecarException("litedb-missing-operation", "LiteDB sidecar request requires an operation.");
    }

    var readOperations = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "ListCollections",
        "Find",
        "FindById",
        "Query",
        "Count",
        "ListIndexes",
        "Explain",
        "SampleSchema"
    };
    var mutationOperations = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "InsertDocument",
        "UpdateDocument",
        "DeleteDocument"
    };

    if (!readOperations.Contains(envelope.Operation!)
        && !mutationOperations.Contains(envelope.Operation!)
        && !envelope.Operation.Equals("SeedFixture", StringComparison.OrdinalIgnoreCase))
    {
        throw new SidecarException("litedb-unsupported-operation", "LiteDB sidecar operation is not supported.");
    }

    if (!envelope.ReadOnly && readOperations.Contains(envelope.Operation!))
    {
        throw new SidecarException("litedb-readonly-required", "LiteDB read operations must use the read-only sidecar envelope.");
    }

    if (envelope.ReadOnly && mutationOperations.Contains(envelope.Operation!))
    {
        throw new SidecarException("litedb-readonly-required", "LiteDB mutation operations require a non-read-only sidecar envelope.");
    }
}

static string BuildConnectionString(string path, string? password)
{
    var parts = new List<string> { $"Filename={EscapeConnectionStringValue(path)}", "Connection=shared" };
    if (!string.IsNullOrWhiteSpace(password))
    {
        parts.Add($"Password={EscapeConnectionStringValue(password)}");
    }

    return string.Join(";", parts);
}

static string EscapeConnectionStringValue(string value)
{
    if (!value.Contains(';') && !value.Contains('"'))
    {
        return value;
    }

    return $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
}

static int EffectiveLimit(SidecarRequest envelope)
{
    var limit = OptionalInt(envelope.Request, "limit") ?? envelope.RowLimit + 1;
    return Math.Clamp(limit, 1, 501);
}

static string RequireCollection(JsonElement request)
{
    return OptionalCollection(request)
        ?? throw new SidecarException("litedb-missing-collection", "LiteDB sidecar request requires a collection.");
}

static string? OptionalCollection(JsonElement request)
{
    if (request.ValueKind != JsonValueKind.Object)
    {
        return null;
    }

    if (!TryGetProperty(request, "collection", out var collectionElement))
    {
        TryGetProperty(request, "collectionName", out collectionElement);
    }

    return collectionElement.ValueKind == JsonValueKind.String
        ? collectionElement.GetString()
        : null;
}

static int? OptionalInt(JsonElement request, string name)
{
    if (request.ValueKind != JsonValueKind.Object || !TryGetProperty(request, name, out var element))
    {
        return null;
    }

    return element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var value) ? value : null;
}

static JsonElement RequireProperty(JsonElement request, string name)
{
    var element = OptionalProperty(request, name);
    if (!element.HasValue)
    {
        throw new SidecarException("litedb-invalid-request", $"LiteDB sidecar request requires {name}.");
    }

    return element.Value;
}

static JsonElement? OptionalProperty(JsonElement request, string name)
{
    if (request.ValueKind != JsonValueKind.Object || !TryGetProperty(request, name, out var element))
    {
        return null;
    }

    return element;
}

static BsonDocument RequireDocument(JsonElement request, string name, string code)
{
    var element = RequireProperty(request, name);
    if (element.ValueKind != JsonValueKind.Object)
    {
        throw new SidecarException(code, $"LiteDB sidecar request property {name} must be a JSON object.");
    }

    var bsonValue = LiteDB.JsonSerializer.Deserialize(element.GetRawText());
    if (!bsonValue.IsDocument)
    {
        throw new SidecarException(code, $"LiteDB sidecar request property {name} must be a JSON object.");
    }

    return bsonValue.AsDocument;
}

static bool TryGetProperty(JsonElement element, string name, out JsonElement value)
{
    foreach (var property in element.EnumerateObject())
    {
        if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
        {
            value = property.Value;
            return true;
        }
    }

    value = default;
    return false;
}

static JsonElement BsonToElement(BsonValue value)
{
    using var document = JsonDocument.Parse(LiteDB.JsonSerializer.Serialize(value));
    return document.RootElement.Clone();
}

static object? BsonToNullableElement(BsonDocument? document)
{
    return document is null ? null : BsonToElement(document);
}

static BsonValue JsonElementToBson(JsonElement element)
{
    return element.ValueKind switch
    {
        JsonValueKind.String => new BsonValue(element.GetString()),
        JsonValueKind.Number when element.TryGetInt64(out var longValue) => new BsonValue(longValue),
        JsonValueKind.Number when element.TryGetDouble(out var doubleValue) => new BsonValue(doubleValue),
        JsonValueKind.True => new BsonValue(true),
        JsonValueKind.False => new BsonValue(false),
        JsonValueKind.Null => BsonValue.Null,
        _ => LiteDB.JsonSerializer.Deserialize(element.GetRawText())
    };
}

static bool TryDocumentId(BsonDocument document, out BsonValue id)
{
    if (document.TryGetValue("_id", out var value) && !value.IsNull)
    {
        id = value;
        return true;
    }

    id = BsonValue.Null;
    return false;
}

static bool BsonValuesEqual(BsonValue left, BsonValue right)
{
    return left.Equals(right) || string.Equals(
        LiteDB.JsonSerializer.Serialize(left),
        LiteDB.JsonSerializer.Serialize(right),
        StringComparison.Ordinal);
}

static void CollectFields(BsonDocument document, IDictionary<string, SortedSet<string>> fields, string prefix)
{
    foreach (var field in document)
    {
        var path = string.IsNullOrEmpty(prefix) ? field.Key : $"{prefix}.{field.Key}";
        AddField(fields, path, TypeName(field.Value));

        if (field.Value.IsDocument)
        {
            CollectFields(field.Value.AsDocument, fields, path);
        }
    }
}

static void AddField(IDictionary<string, SortedSet<string>> fields, string path, string type)
{
    if (!fields.TryGetValue(path, out var types))
    {
        types = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        fields[path] = types;
    }

    types.Add(type);
}

static string? BsonString(BsonDocument document, string name)
{
    return document.TryGetValue(name, out var value) && value.IsString ? value.AsString : null;
}

static bool BsonBool(BsonDocument document, string name)
{
    return document.TryGetValue(name, out var value) && value.IsBoolean && value.AsBoolean;
}

static string TypeName(BsonValue value)
{
    if (value.IsNull)
    {
        return "null";
    }

    if (value.IsString)
    {
        return "string";
    }

    if (value.IsInt32 || value.IsInt64 || value.IsDouble || value.IsDecimal)
    {
        return "number";
    }

    if (value.IsBoolean)
    {
        return "boolean";
    }

    if (value.IsArray)
    {
        return "array";
    }

    if (value.IsDocument)
    {
        return "document";
    }

    return value.Type.ToString().ToLowerInvariant();
}

static void WriteOk(object response)
{
    Console.Out.Write(System.Text.Json.JsonSerializer.Serialize(new { ok = true, response }, JsonOptions.Default));
}

static void WriteError(string code, string message)
{
    Console.Out.Write(System.Text.Json.JsonSerializer.Serialize(new { ok = false, code, message }, JsonOptions.Default));
}

internal sealed class SidecarRequest
{
    public string? Engine { get; set; }
    public int ProtocolVersion { get; set; }
    public string? DatabasePath { get; set; }
    public string? Password { get; set; }
    public string? Operation { get; set; }
    public JsonElement Request { get; set; }
    public int RowLimit { get; set; } = 50;
    public bool ReadOnly { get; set; } = true;
}

internal sealed class SidecarException : Exception
{
    public SidecarException(string code, string message) : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}

internal static class JsonOptions
{
    public static readonly JsonSerializerOptions Default = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };
}
