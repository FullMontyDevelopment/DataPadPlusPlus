use std::fmt::Write as _;

use super::*;

pub(crate) static ADAPTER: ProjectExportClientAdapter = ProjectExportClientAdapter {
    id: "dotnet-mongodb-native",
    framework: "dotnet",
    engine: "mongodb",
    client_label: "MongoDB.Driver",
    configuration_key: "MONGODB_URI",
    configuration_example: "mongodb://localhost:27017",
    additional_configuration: &[],
    safety_note: "MongoDB identities are restricted to one exact _id value. Patches use $set with validated top-level field names and cannot change _id.",
    rust_version: "1.89",
    sql: None,
    dependencies,
    render_client_files,
};

fn dependencies(_spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    vec![ProjectDependency {
        package: "MongoDB.Driver".into(),
        version: "3.10.0".into(),
        declaration: "<PackageReference Include=\"MongoDB.Driver\" />".into(),
        build: false,
    }]
}

fn render_client_files(
    spec: &ProjectExportSpec,
    _adapter: &ProjectExportClientAdapter,
) -> Vec<ProjectFile> {
    let root = safe_file_stem(&spec.project_name);
    vec![
        project_file(&root, "DatastoreClient.cs", client_source(spec)),
        project_file(&root, "DatastoreRepository.cs", repository_source(spec)),
    ]
}

fn client_source(spec: &ProjectExportSpec) -> String {
    format!(
        r#"using MongoDB.Driver;

namespace {};

public static class DatastoreClientRegistration
{{
    public static IServiceCollection AddDatastoreClient(
        this IServiceCollection services,
        IConfiguration configuration)
    {{
        var uri = configuration["MONGODB_URI"] ?? Environment.GetEnvironmentVariable("MONGODB_URI");
        if (string.IsNullOrWhiteSpace(uri))
        {{
            throw new InvalidOperationException("Set MONGODB_URI before starting the API.");
        }}
        services.AddSingleton<IMongoClient>(_ => new MongoClient(uri));
        services.AddTransient<DatastoreRepository>();
        return services;
    }}
}}
"#,
        spec.namespace
    )
}

fn repository_source(spec: &ProjectExportSpec) -> String {
    let database = spec
        .resources
        .iter()
        .find_map(|resource| resource.database_name.as_deref())
        .unwrap_or("admin");
    let methods = spec
        .resources
        .iter()
        .map(|resource| resource_methods(resource, &spec.protocol))
        .collect::<String>();
    format!(
        r#"using System.Text.Json;
using MongoDB.Bson;
using MongoDB.Bson.IO;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;

namespace {namespace};

public sealed class RepositoryException(string kind, string message, Exception? inner = null)
    : Exception(message, inner)
{{
    public string Kind {{ get; }} = kind;
    public static RepositoryException Invalid(string message) => new("invalid", message);
    public static RepositoryException NotFound(string message) => new("not-found", message);
    public static RepositoryException Unavailable(string message, Exception? inner = null) =>
        new("unavailable", message, inner);
    public static RepositoryException Datastore(Exception inner) =>
        new("datastore", "The MongoDB operation failed.", inner);
}}

public sealed class DatastoreRepository(IMongoClient client)
{{
    public async Task PingAsync()
    {{
        try
        {{
            await client.GetDatabase({database})
                .RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1));
        }}
        catch (Exception error)
        {{
            throw RepositoryException.Unavailable("MongoDB health check failed.", error);
        }}
    }}

{methods}}}

file static class MongoDocumentCodec
{{
    private static readonly JsonWriterSettings WriterSettings = new()
    {{
        OutputMode = JsonOutputMode.RelaxedExtendedJson,
    }};

    public static JsonElement ToJson(BsonDocument document) =>
        JsonSerializer.Deserialize<JsonElement>(document.ToJson(WriterSettings));

    public static BsonDocument FromJson(JsonElement value)
    {{
        if (value.ValueKind != JsonValueKind.Object)
        {{
            throw RepositoryException.Invalid("Mutation values must be a JSON object.");
        }}
        try
        {{
            return BsonDocument.Parse(value.GetRawText());
        }}
        catch (Exception error)
        {{
            throw RepositoryException.Invalid($"Invalid MongoDB Extended JSON: {{error.Message}}");
        }}
    }}

    public static BsonValue ExactIdentity(string raw, bool objectId)
    {{
        JsonElement value;
        try
        {{
            value = JsonSerializer.Deserialize<JsonElement>(raw);
        }}
        catch
        {{
            value = JsonSerializer.SerializeToElement(raw);
        }}
        if (value.ValueKind == JsonValueKind.Object)
        {{
            var properties = value.EnumerateObject().ToArray();
            if (properties.Length != 1 || properties[0].Name != "_id")
            {{
                throw RepositoryException.Invalid(
                    "MongoDB identity objects must contain exactly the _id field.");
            }}
            value = properties[0].Value.Clone();
        }}
        if (value.ValueKind == JsonValueKind.Object
            && value.TryGetProperty("$oid", out var taggedOid)
            && taggedOid.ValueKind == JsonValueKind.String)
        {{
            return ParseObjectId(taggedOid.GetString()!);
        }}
        if (objectId && value.ValueKind == JsonValueKind.String)
        {{
            return ParseObjectId(value.GetString()!);
        }}
        try
        {{
            return BsonDocument.Parse($"{{{{ \"value\": {{value.GetRawText()}} }}}}")["value"];
        }}
        catch (Exception error)
        {{
            throw RepositoryException.Invalid($"Invalid MongoDB identity: {{error.Message}}");
        }}
    }}

    public static void ValidatePatch(BsonDocument changes)
    {{
        if (changes.ElementCount == 0)
        {{
            throw RepositoryException.Invalid("Patch values cannot be empty.");
        }}
        foreach (var element in changes)
        {{
            if (element.Name == "_id")
            {{
                throw RepositoryException.Invalid("MongoDB patches cannot change _id.");
            }}
            if (element.Name.StartsWith('$') || element.Name.Contains('.'))
            {{
                throw RepositoryException.Invalid(
                    "MongoDB patch field names cannot start with $ or contain dots.");
            }}
        }}
    }}

    private static ObjectId ParseObjectId(string raw)
    {{
        if (!ObjectId.TryParse(raw, out var objectId))
        {{
            throw RepositoryException.Invalid("Invalid MongoDB ObjectId.");
        }}
        return objectId;
    }}
}}
"#,
        namespace = spec.namespace,
        database = csharp_string_literal(database),
        methods = methods,
    )
}

fn resource_methods(resource: &ProjectResourceModel, protocol: &str) -> String {
    let base = pascal_case(&resource.endpoint_slug);
    let model = &resource.model_name;
    let database = csharp_string_literal(resource.database_name.as_deref().unwrap_or("admin"));
    let collection = csharp_string_literal(&resource.table_name);
    let object_id = resource
        .primary_fields
        .first()
        .is_some_and(|field| field.data_type.eq_ignore_ascii_case("objectId"));
    let output_type = if protocol == "graphql" {
        model.to_string()
    } else {
        "JsonElement".into()
    };
    let convert = if protocol == "graphql" {
        format!("{model}.FromDocument(MongoDocumentCodec.ToJson(document))")
    } else {
        "MongoDocumentCodec.ToJson(document)".into()
    };
    let mut output = format!(
        r#"    public async Task<IReadOnlyList<{output_type}>> Search{base}Async(int limit)
    {{
        var collection = client.GetDatabase({database}).GetCollection<BsonDocument>({collection});
        try
        {{
            var documents = await collection.Find(FilterDefinition<BsonDocument>.Empty)
                .Limit(Math.Clamp(limit, 1, 1_000))
                .ToListAsync();
            return documents.Select(document => {convert}).ToArray();
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

"#,
        output_type = output_type,
        base = base,
        database = database,
        collection = collection,
        convert = convert,
    );
    if resource.primary_fields.is_empty() {
        return output;
    }
    let _ = write!(
        output,
        r#"    public async Task<{output_type}> Get{base}Async(string identity)
    {{
        var id = MongoDocumentCodec.ExactIdentity(identity, {object_id});
        try
        {{
            var document = await client.GetDatabase({database})
                .GetCollection<BsonDocument>({collection})
                .Find(Builders<BsonDocument>.Filter.Eq("_id", id))
                .FirstOrDefaultAsync()
                ?? throw RepositoryException.NotFound("MongoDB document was not found.");
            return {convert};
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

"#,
        output_type = output_type,
        base = base,
        object_id = object_id.to_string().to_lowercase(),
        database = database,
        collection = collection,
        convert = convert,
    );
    if resource.mode != ProjectResourceMode::Crud {
        return output;
    }
    let _ = write!(
        output,
        r#"    public async Task<{output_type}> Create{base}Async(JsonElement values)
    {{
        var document = MongoDocumentCodec.FromJson(values);
        var collection = client.GetDatabase({database}).GetCollection<BsonDocument>({collection});
        try
        {{
            await collection.InsertOneAsync(document);
            return {convert};
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

    public async Task<{output_type}> Update{base}Async(string identity, JsonElement values)
    {{
        var id = MongoDocumentCodec.ExactIdentity(identity, {object_id});
        var changes = MongoDocumentCodec.FromJson(values);
        MongoDocumentCodec.ValidatePatch(changes);
        try
        {{
            var document = await client.GetDatabase({database})
                .GetCollection<BsonDocument>({collection})
                .FindOneAndUpdateAsync(
                    Builders<BsonDocument>.Filter.Eq("_id", id),
                    new BsonDocument("$set", changes),
                    new FindOneAndUpdateOptions<BsonDocument> {{ ReturnDocument = ReturnDocument.After }})
                ?? throw RepositoryException.NotFound("MongoDB document was not found.");
            return {convert};
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

    public async Task<JsonElement> Delete{base}Async(string identity)
    {{
        var id = MongoDocumentCodec.ExactIdentity(identity, {object_id});
        try
        {{
            var document = await client.GetDatabase({database})
                .GetCollection<BsonDocument>({collection})
                .FindOneAndDeleteAsync(Builders<BsonDocument>.Filter.Eq("_id", id))
                ?? throw RepositoryException.NotFound("MongoDB document was not found.");
            return MongoDocumentCodec.ToJson(document);
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

"#,
        output_type = output_type,
        base = base,
        object_id = object_id.to_string().to_lowercase(),
        database = database,
        collection = collection,
        convert = convert,
    );
    output
}
