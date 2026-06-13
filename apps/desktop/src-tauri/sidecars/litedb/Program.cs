using System.Text.Json;
using LiteDB;

var input = Console.In.ReadToEnd();
SidecarRequest? envelope = null;

try
{
    envelope = System.Text.Json.JsonSerializer.Deserialize<SidecarRequest>(input, JsonOptions.Default)
        ?? throw new SidecarException("litedb-invalid-request", "LiteDB sidecar request was empty.");

    ValidateEnvelope(envelope);
    var response = Dispatch(envelope);
    WriteOk(response);
}
catch (SidecarException ex)
{
    WriteError(ex.Code, RedactSidecarMessage(envelope, ex.Message));
}
catch (Exception ex)
{
    WriteError("litedb-sidecar-error", RedactSidecarMessage(envelope, ex.Message));
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

    if (operation.Equals("ValidateEncryptedFile", StringComparison.OrdinalIgnoreCase))
    {
        return ValidateEncryptedFile(envelope);
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
        "ValidateEncryptedFile" => ValidateEncryptedFile(envelope),
        "ExportCollection" => ExportCollection(db, envelope),
        "ImportCollection" => ImportCollection(db, envelope),
        "ListFiles" => ListFiles(db, envelope),
        "ExportFile" => ExportFile(db, envelope),
        "ImportFile" => ImportFile(db, envelope),
        "DeleteFile" => DeleteFile(db, envelope),
        "EnsureIndex" => EnsureIndex(db, envelope),
        "DropIndex" => DropIndex(db, envelope),
        "DropCollection" => DropCollection(db, envelope),
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

static object ValidateEncryptedFile(SidecarRequest envelope)
{
    if (string.IsNullOrWhiteSpace(envelope.Password))
    {
        throw new SidecarException(
            "litedb-encrypted-password-required",
            "LiteDB encrypted-file validation requires a password.");
    }

    try
    {
        using var db = new LiteDatabase(BuildConnectionString(envelope.DatabasePath!, envelope.Password));
        var collections = db.GetCollectionNames()
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(envelope.RowLimit, 1, 50))
            .ToArray();

        return new
        {
            encryptedFile = new
            {
                passwordConfigured = true,
                passwordMaterial = "redacted",
                engineOpenValidated = true,
                readProbeValidated = true,
                writeProbeValidated = !envelope.ReadOnly,
                databasePathMaterial = "redacted",
                collections,
                collectionCount = collections.Length,
                evidence = "dotnet-litedb-sidecar-encrypted-file"
            }
        };
    }
    catch
    {
        throw new SidecarException(
            "litedb-encrypted-open-failed",
            "LiteDB encrypted file could not be opened with the supplied password.");
    }
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
    var indexes = IndexSummaries(db, collectionName);

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

static object ExportCollection(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var targetPath = RequireAbsolutePath(envelope.Request, new[] { "targetPath", "outputPath" }, "litedb-export-target-required");
    var format = OptionalString(envelope.Request, "format")?.ToLowerInvariant() ?? FormatFromPath(targetPath);
    if (!IsDocumentFileFormat(format))
    {
        throw new SidecarException("litedb-export-format", "LiteDB collection export supports json and ndjson formats.");
    }

    var parent = Path.GetDirectoryName(targetPath);
    if (!string.IsNullOrWhiteSpace(parent) && !Directory.Exists(parent))
    {
        throw new SidecarException("litedb-export-parent-missing", "LiteDB export target folder does not exist.");
    }

    var overwrite = OptionalBool(envelope.Request, "overwrite") ?? false;
    if (File.Exists(targetPath) && !overwrite)
    {
        throw new SidecarException("litedb-export-target-exists", "LiteDB export target already exists; set overwrite to true to replace it.");
    }

    var limit = ExportImportLimit(envelope);
    var collection = db.GetCollection<BsonDocument>(collectionName);
    var totalCount = collection.Count();
    var documents = collection.FindAll()
        .Take(limit)
        .Select(BsonToElement)
        .ToArray();

    WriteDocumentsToPath(targetPath, format, documents);
    var bytesWritten = new FileInfo(targetPath).Length;

    return new
    {
        collection = collectionName,
        operation = "ExportCollection",
        format,
        targetPath,
        exportedCount = documents.Length,
        totalCount,
        truncated = totalCount > documents.Length,
        bytesWritten,
        evidence = new
        {
            engineRuntimeValidated = true,
            fileWorkflowValidated = true,
            readOnlyEnvelope = envelope.ReadOnly,
            boundedLimit = limit,
            before = new { operation = "Count", count = totalCount },
            after = new { operation = "FileWrite", bytesWritten }
        }
    };
}

static object ImportCollection(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var sourcePath = RequireAbsolutePath(envelope.Request, new[] { "sourcePath", "inputPath" }, "litedb-import-source-required");
    if (!File.Exists(sourcePath))
    {
        throw new SidecarException("litedb-import-source-missing", "LiteDB import source file does not exist.");
    }

    var sourceInfo = new FileInfo(sourcePath);
    if (sourceInfo.Length > 16 * 1024 * 1024)
    {
        throw new SidecarException("litedb-import-source-too-large", "LiteDB import source exceeds the 16 MiB sidecar safety limit.");
    }

    var format = OptionalString(envelope.Request, "format")?.ToLowerInvariant() ?? FormatFromPath(sourcePath);
    if (!IsDocumentFileFormat(format))
    {
        throw new SidecarException("litedb-import-format", "LiteDB collection import supports json and ndjson formats.");
    }

    var mode = OptionalString(envelope.Request, "mode")?.ToLowerInvariant() ?? "insert";
    if (!new[] { "insert", "append" }.Contains(mode, StringComparer.OrdinalIgnoreCase))
    {
        throw new SidecarException("litedb-import-mode", "LiteDB collection import currently supports insert/append mode only.");
    }

    var limit = ExportImportLimit(envelope);
    var documents = ReadDocumentsFromPath(sourcePath, format, limit);
    var collection = db.GetCollection<BsonDocument>(collectionName);
    var beforeCount = collection.Count();
    var imported = 0;

    db.BeginTrans();
    try
    {
        foreach (var document in documents)
        {
            collection.Insert(document);
            imported++;
        }
        db.Commit();
    }
    catch
    {
        db.Rollback();
        throw;
    }

    var afterCount = collection.Count();

    return new
    {
        collection = collectionName,
        operation = "ImportCollection",
        format,
        mode,
        sourcePath,
        importedCount = imported,
        beforeCount,
        afterCount,
        bytesRead = sourceInfo.Length,
        evidence = new
        {
            engineRuntimeValidated = true,
            fileWorkflowValidated = true,
            mutationExecutionValidated = imported > 0,
            boundedLimit = limit,
            before = new { operation = "Count", count = beforeCount },
            after = new { operation = "Count", count = afterCount }
        }
    };
}

static object ListFiles(LiteDatabase db, SidecarRequest envelope)
{
    var limit = EffectiveLimit(envelope);
    var allFiles = db.FileStorage
        .FindAll()
        .OrderBy(file => file.Id, StringComparer.OrdinalIgnoreCase)
        .ToArray();
    var files = allFiles
        .Take(limit)
        .Select(FileSummary)
        .ToArray();

    return new
    {
        operation = "ListFiles",
        files,
        count = files.Length,
        totalCount = allFiles.Length,
        hasMore = allFiles.Length > files.Length,
        evidence = new
        {
            engineRuntimeValidated = true,
            fileStorageWorkflowValidated = true,
            readOnlyEnvelope = envelope.ReadOnly,
            boundedLimit = limit
        }
    };
}

static object ExportFile(LiteDatabase db, SidecarRequest envelope)
{
    var fileId = RequireFileId(envelope.Request);
    var targetPath = RequireAbsolutePath(envelope.Request, new[] { "targetPath", "outputPath" }, "litedb-file-export-target-required");
    EnsureParentDirectory(targetPath, "litedb-file-export-parent-missing");
    var overwrite = OptionalBool(envelope.Request, "overwrite") ?? false;
    if (File.Exists(targetPath) && !overwrite)
    {
        throw new SidecarException("litedb-file-export-target-exists", "LiteDB file export target already exists; set overwrite to true to replace it.");
    }

    var file = db.FileStorage.FindById(fileId)
        ?? throw new SidecarException("litedb-file-storage-missing", "LiteDB stored file does not exist.");
    using (var output = File.Create(targetPath))
    {
        db.FileStorage.Download(fileId, output);
    }

    var targetInfo = new FileInfo(targetPath);
    return new
    {
        operation = "ExportFile",
        fileId,
        targetPath,
        bytesWritten = targetInfo.Length,
        file = FileSummary(file),
        evidence = new
        {
            engineRuntimeValidated = true,
            fileStorageWorkflowValidated = true,
            readOnlyEnvelope = envelope.ReadOnly,
            before = new { operation = "FindFile", matched = true },
            after = new { operation = "FileWrite", bytesWritten = targetInfo.Length }
        }
    };
}

static object ImportFile(LiteDatabase db, SidecarRequest envelope)
{
    var fileId = RequireFileId(envelope.Request);
    var sourcePath = RequireAbsolutePath(envelope.Request, new[] { "sourcePath", "inputPath" }, "litedb-file-import-source-required");
    if (!File.Exists(sourcePath))
    {
        throw new SidecarException("litedb-file-import-source-missing", "LiteDB file import source file does not exist.");
    }

    var sourceInfo = new FileInfo(sourcePath);
    if (sourceInfo.Length > 64 * 1024 * 1024)
    {
        throw new SidecarException("litedb-file-import-source-too-large", "LiteDB file import source exceeds the 64 MiB sidecar safety limit.");
    }

    var overwrite = OptionalBool(envelope.Request, "overwrite") ?? false;
    var before = db.FileStorage.FindById(fileId);
    if (before is not null && !overwrite)
    {
        throw new SidecarException("litedb-file-storage-target-exists", "LiteDB stored file already exists; set overwrite to true to replace it.");
    }

    if (before is not null && overwrite)
    {
        db.FileStorage.Delete(fileId);
    }

    var filename = OptionalString(envelope.Request, "filename")
        ?? Path.GetFileName(sourcePath)
        ?? fileId;
    var metadata = OptionalDocument(envelope.Request, "metadata") ?? new BsonDocument();
    var contentType = OptionalString(envelope.Request, "contentType") ?? OptionalString(envelope.Request, "mimeType");
    if (!string.IsNullOrWhiteSpace(contentType))
    {
        metadata["contentType"] = contentType;
    }

    LiteFileInfo<string> uploaded;
    using (var input = File.OpenRead(sourcePath))
    {
        uploaded = db.FileStorage.Upload(fileId, filename, input, metadata);
    }

    return new
    {
        operation = "ImportFile",
        fileId,
        sourcePath,
        filename,
        bytesRead = sourceInfo.Length,
        replaced = before is not null,
        beforeFile = FileSummary(before),
        afterFile = FileSummary(uploaded),
        evidence = new
        {
            engineRuntimeValidated = true,
            fileStorageWorkflowValidated = true,
            mutationExecutionValidated = true,
            before = new { operation = "FindFile", matched = before is not null },
            after = new { operation = "FindFile", matched = true }
        }
    };
}

static object DeleteFile(LiteDatabase db, SidecarRequest envelope)
{
    var fileId = RequireFileId(envelope.Request);
    var before = db.FileStorage.FindById(fileId);
    var deleted = db.FileStorage.Delete(fileId);
    var after = db.FileStorage.FindById(fileId);

    return new
    {
        operation = "DeleteFile",
        fileId,
        deleted,
        beforeFile = FileSummary(before),
        afterFile = FileSummary(after),
        evidence = new
        {
            engineRuntimeValidated = true,
            fileStorageWorkflowValidated = true,
            mutationExecutionValidated = deleted,
            before = new { operation = "FindFile", matched = before is not null },
            after = new { operation = "FindFile", matched = after is not null }
        }
    };
}

static object EnsureIndex(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var indexName = OptionalString(envelope.Request, "indexName")
        ?? OptionalString(envelope.Request, "name")
        ?? throw new SidecarException("litedb-index-name-required", "LiteDB index creation requires an indexName.");
    var expression = OptionalString(envelope.Request, "expression")
        ?? FieldExpression(OptionalString(envelope.Request, "field")
            ?? throw new SidecarException("litedb-index-field-required", "LiteDB index creation requires a field or expression."));
    var unique = OptionalBool(envelope.Request, "unique") ?? false;
    var collection = db.GetCollection<BsonDocument>(collectionName);
    var before = IndexSummaries(db, collectionName);
    var created = collection.EnsureIndex(indexName, expression, unique);
    var after = IndexSummaries(db, collectionName);

    return new
    {
        collection = collectionName,
        operation = "EnsureIndex",
        indexName,
        expression,
        unique,
        created,
        beforeIndexCount = before.Length,
        afterIndexCount = after.Length,
        indexes = after,
        evidence = new
        {
            engineRuntimeValidated = true,
            managementExecutionValidated = true,
            before = new { operation = "ListIndexes", count = before.Length },
            after = new { operation = "ListIndexes", count = after.Length }
        }
    };
}

static object DropIndex(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var indexName = OptionalString(envelope.Request, "indexName")
        ?? OptionalString(envelope.Request, "name")
        ?? throw new SidecarException("litedb-index-name-required", "LiteDB index drop requires an indexName.");
    if (string.Equals(indexName, "_id", StringComparison.OrdinalIgnoreCase))
    {
        throw new SidecarException("litedb-index-drop-blocked", "LiteDB `_id` index cannot be dropped.");
    }

    var collection = db.GetCollection<BsonDocument>(collectionName);
    var before = IndexSummaries(db, collectionName);
    var dropped = collection.DropIndex(indexName);
    var after = IndexSummaries(db, collectionName);

    return new
    {
        collection = collectionName,
        operation = "DropIndex",
        indexName,
        dropped,
        beforeIndexCount = before.Length,
        afterIndexCount = after.Length,
        indexes = after,
        evidence = new
        {
            engineRuntimeValidated = true,
            managementExecutionValidated = dropped,
            before = new { operation = "ListIndexes", count = before.Length },
            after = new { operation = "ListIndexes", count = after.Length }
        }
    };
}

static object DropCollection(LiteDatabase db, SidecarRequest envelope)
{
    var collectionName = RequireCollection(envelope.Request);
    var before = CollectionNames(db);
    var existed = before.Contains(collectionName, StringComparer.OrdinalIgnoreCase);
    var dropped = db.DropCollection(collectionName);
    var after = CollectionNames(db);

    return new
    {
        collection = collectionName,
        operation = "DropCollection",
        existed,
        dropped,
        beforeCollectionCount = before.Length,
        afterCollectionCount = after.Length,
        collections = after,
        evidence = new
        {
            engineRuntimeValidated = true,
            managementExecutionValidated = dropped,
            before = new { operation = "ListCollections", count = before.Length },
            after = new { operation = "ListCollections", count = after.Length }
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
        "SampleSchema",
        "ValidateEncryptedFile",
        "ExportCollection",
        "ListFiles",
        "ExportFile"
    };
    var mutationOperations = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "InsertDocument",
        "UpdateDocument",
        "DeleteDocument",
        "ImportCollection",
        "ImportFile",
        "DeleteFile",
        "EnsureIndex",
        "DropIndex",
        "DropCollection"
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

static string RedactSidecarMessage(SidecarRequest? envelope, string message)
{
    var redacted = message;
    if (!string.IsNullOrWhiteSpace(envelope?.Password))
    {
        redacted = redacted.Replace(envelope.Password, "[redacted]", StringComparison.Ordinal);
    }

    if (!string.IsNullOrWhiteSpace(envelope?.DatabasePath))
    {
        redacted = redacted.Replace(envelope.DatabasePath, "[redacted-path]", StringComparison.Ordinal);
    }

    return redacted;
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

static string RequireFileId(JsonElement request)
{
    return OptionalString(request, "fileId")
        ?? OptionalString(request, "id")
        ?? OptionalString(request, "path")
        ?? throw new SidecarException("litedb-file-id-required", "LiteDB file storage operations require a fileId.");
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

static string? OptionalString(JsonElement request, string name)
{
    var element = OptionalProperty(request, name);
    return element.HasValue && element.Value.ValueKind == JsonValueKind.String
        ? element.Value.GetString()?.Trim()
        : null;
}

static bool? OptionalBool(JsonElement request, string name)
{
    var element = OptionalProperty(request, name);
    if (!element.HasValue)
    {
        return null;
    }

    return element.Value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String when bool.TryParse(element.Value.GetString(), out var value) => value,
        _ => null
    };
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

static BsonDocument? OptionalDocument(JsonElement request, string name)
{
    var element = OptionalProperty(request, name);
    if (!element.HasValue)
    {
        return null;
    }

    if (element.Value.ValueKind != JsonValueKind.Object)
    {
        throw new SidecarException("litedb-file-metadata-invalid", $"LiteDB sidecar request property {name} must be a JSON object.");
    }

    var bsonValue = LiteDB.JsonSerializer.Deserialize(element.Value.GetRawText());
    if (!bsonValue.IsDocument)
    {
        throw new SidecarException("litedb-file-metadata-invalid", $"LiteDB sidecar request property {name} must be a JSON object.");
    }

    return bsonValue.AsDocument;
}

static string RequireAbsolutePath(JsonElement request, string[] names, string code)
{
    foreach (var name in names)
    {
        var value = OptionalString(request, name);
        if (string.IsNullOrWhiteSpace(value))
        {
            continue;
        }

        if (value.Contains('<') || value.Contains('>'))
        {
            throw new SidecarException(code, "LiteDB file workflow requires a concrete file path, not a placeholder.");
        }

        if (!Path.IsPathRooted(value))
        {
            throw new SidecarException(code, "LiteDB file workflow requires an absolute file path.");
        }

        var fullPath = Path.GetFullPath(value);
        return fullPath;
    }

    throw new SidecarException(code, "LiteDB file workflow requires a concrete file path.");
}

static void EnsureParentDirectory(string path, string code)
{
    var parent = Path.GetDirectoryName(path);
    if (!string.IsNullOrWhiteSpace(parent) && !Directory.Exists(parent))
    {
        throw new SidecarException(code, "LiteDB file workflow parent folder does not exist.");
    }
}

static string FormatFromPath(string path)
{
    return Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".ndjson" or ".jsonl" => "ndjson",
        _ => "json"
    };
}

static bool IsDocumentFileFormat(string format)
{
    return string.Equals(format, "json", StringComparison.OrdinalIgnoreCase)
        || string.Equals(format, "ndjson", StringComparison.OrdinalIgnoreCase)
        || string.Equals(format, "jsonl", StringComparison.OrdinalIgnoreCase);
}

static int ExportImportLimit(SidecarRequest envelope)
{
    var limit = OptionalInt(envelope.Request, "limit") ?? envelope.RowLimit;
    return Math.Clamp(limit, 1, 10_000);
}

static void WriteDocumentsToPath(string targetPath, string format, JsonElement[] documents)
{
    if (format.Equals("ndjson", StringComparison.OrdinalIgnoreCase)
        || format.Equals("jsonl", StringComparison.OrdinalIgnoreCase))
    {
        File.WriteAllLines(targetPath, documents.Select(document => document.GetRawText()));
        return;
    }

    using var stream = File.Create(targetPath);
    System.Text.Json.JsonSerializer.Serialize(stream, documents, JsonOptions.Pretty);
}

static BsonDocument[] ReadDocumentsFromPath(string sourcePath, string format, int limit)
{
    if (format.Equals("ndjson", StringComparison.OrdinalIgnoreCase)
        || format.Equals("jsonl", StringComparison.OrdinalIgnoreCase))
    {
        return File.ReadLines(sourcePath)
            .Select(line => line.Trim())
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .Take(limit)
            .Select(JsonTextToDocument)
            .ToArray();
    }

    using var document = JsonDocument.Parse(File.ReadAllText(sourcePath));
    if (document.RootElement.ValueKind == JsonValueKind.Array)
    {
        return document.RootElement
            .EnumerateArray()
            .Take(limit)
            .Select(element => JsonTextToDocument(element.GetRawText()))
            .ToArray();
    }

    return new[] { JsonTextToDocument(document.RootElement.GetRawText()) };
}

static BsonDocument JsonTextToDocument(string rawJson)
{
    var bsonValue = LiteDB.JsonSerializer.Deserialize(rawJson);
    if (!bsonValue.IsDocument)
    {
        throw new SidecarException("litedb-import-document-invalid", "LiteDB import documents must be JSON objects.");
    }

    return bsonValue.AsDocument;
}

static string FieldExpression(string field)
{
    var trimmed = field.Trim();
    if (trimmed.StartsWith("$.", StringComparison.Ordinal) || trimmed.StartsWith("@", StringComparison.Ordinal))
    {
        return trimmed;
    }

    return $"$.{trimmed.TrimStart('.')}";
}

static string[] CollectionNames(LiteDatabase db)
{
    return db.GetCollectionNames()
        .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
        .ToArray();
}

static object? FileSummary(LiteFileInfo<string>? file)
{
    if (file is null)
    {
        return null;
    }

    return new
    {
        id = file.Id,
        filename = file.Filename,
        mimeType = file.MimeType,
        length = file.Length,
        chunks = file.Chunks,
        uploadDate = file.UploadDate,
        metadata = file.Metadata is null ? null : (object)BsonToElement(file.Metadata)
    };
}

static object[] IndexSummaries(LiteDatabase db, string collectionName)
{
    return db.Execute("SELECT $ FROM $indexes")
        .ToEnumerable()
        .Where(value => value.IsDocument)
        .Select(value => value.AsDocument)
        .Where(document => string.Equals(BsonString(document, "collection"), collectionName, StringComparison.OrdinalIgnoreCase))
        .Select(document => (object)new
        {
            collection = collectionName,
            name = BsonString(document, "name") ?? "_id",
            expression = BsonString(document, "expression") ?? "$._id",
            unique = BsonBool(document, "unique")
        })
        .ToArray();
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

    public static readonly JsonSerializerOptions Pretty = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };
}
