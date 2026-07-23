use std::fmt::Write as _;

use super::*;

pub(crate) static ADAPTER: ProjectExportClientAdapter = ProjectExportClientAdapter {
    id: "dotnet-dynamodb-native",
    framework: "dotnet",
    engine: "dynamodb",
    client_label: "AWS SDK for .NET / DynamoDB",
    configuration_key: "AWS_REGION",
    configuration_example: "us-east-1",
    additional_configuration: &[("DYNAMODB_ENDPOINT_URL", "http://127.0.0.1:8000")],
    safety_note: "DynamoDB writes use conditional expressions: creates cannot overwrite an item, patches cannot change keys, and updates/deletes require the target to exist. Scans are bounded but consume table capacity.",
    rust_version: "1.94.1",
    sql: None,
    dependencies,
    render_client_files,
};

fn dependencies(_spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    vec![ProjectDependency {
        package: "AWSSDK.DynamoDBv2".into(),
        version: "4.0.101.3".into(),
        declaration: "<PackageReference Include=\"AWSSDK.DynamoDBv2\" />".into(),
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
        r#"using Amazon.DynamoDBv2;

namespace {};

public static class DatastoreClientRegistration
{{
    public static IServiceCollection AddDatastoreClient(
        this IServiceCollection services,
        IConfiguration configuration)
    {{
        var clientConfiguration = new AmazonDynamoDBConfig();
        var endpoint = configuration["DYNAMODB_ENDPOINT_URL"]
            ?? Environment.GetEnvironmentVariable("DYNAMODB_ENDPOINT_URL");
        if (!string.IsNullOrWhiteSpace(endpoint))
        {{
            clientConfiguration.ServiceURL = endpoint;
        }}
        services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient(clientConfiguration));
        services.AddTransient<DatastoreRepository>();
        return services;
    }}
}}
"#,
        spec.namespace
    )
}

fn repository_source(spec: &ProjectExportSpec) -> String {
    let health_checks = spec
        .resources
        .iter()
        .map(|resource| {
            format!(
                "        await client.DescribeTableAsync(new DescribeTableRequest {{ TableName = {} }});\n",
                csharp_string_literal(&resource.table_name)
            )
        })
        .collect::<String>();
    let methods = spec
        .resources
        .iter()
        .map(|resource| resource_methods(resource, &spec.protocol))
        .collect::<String>();
    format!(
        r#"using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

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
        new("datastore", "The DynamoDB operation failed.", inner);
}}

public sealed class DatastoreRepository(IAmazonDynamoDB client)
{{
    public async Task PingAsync()
    {{
        try
        {{
{health_checks}        }}
        catch (Exception error)
        {{
            throw RepositoryException.Unavailable("DynamoDB health check failed.", error);
        }}
    }}

{methods}}}

file static class DynamoDocumentCodec
{{
    public static JsonElement ToJson(Dictionary<string, AttributeValue> document) =>
        JsonSerializer.SerializeToElement(
            document.ToDictionary(item => item.Key, item => ToNode(item.Value)));

    public static Dictionary<string, AttributeValue> FromJson(JsonElement value)
    {{
        if (value.ValueKind != JsonValueKind.Object)
        {{
            throw RepositoryException.Invalid("Mutation values must be a JSON object.");
        }}
        return value.EnumerateObject().ToDictionary(
            property => property.Name,
            property => FromJsonValue(property.Value));
    }}

    public static Dictionary<string, AttributeValue> ExactKey(
        string raw,
        IReadOnlyList<(string Name, string Type)> schema)
    {{
        JsonElement identity;
        try {{ identity = JsonSerializer.Deserialize<JsonElement>(raw); }}
        catch (Exception error)
        {{
            throw RepositoryException.Invalid($"DynamoDB identity must be a JSON object: {{error.Message}}");
        }}
        if (identity.ValueKind != JsonValueKind.Object)
        {{
            throw RepositoryException.Invalid("DynamoDB identity must be a JSON object.");
        }}
        var properties = identity.EnumerateObject().ToArray();
        if (properties.Length != schema.Count
            || schema.Any(key => !properties.Any(property => property.Name == key.Name)))
        {{
            throw RepositoryException.Invalid(
                "DynamoDB identity must contain exactly the configured key fields.");
        }}
        return schema.ToDictionary(
            key => key.Name,
            key =>
            {{
                var value = FromJsonValue(properties.Single(property => property.Name == key.Name).Value);
                ValidateKeyType(key.Name, key.Type, value);
                return value;
            }});
    }}

    public static void ValidateKeyType(string name, string expected, AttributeValue value)
    {{
        var valid = expected switch
        {{
            "S" or "string" => value.S is not null,
            "N" or "number" => value.N is not null,
            "B" or "binary" => value.B is not null,
            _ => false,
        }};
        if (!valid)
        {{
            throw RepositoryException.Invalid($"DynamoDB key `{{name}}` has the wrong type.");
        }}
    }}

    private static JsonNode? ToNode(AttributeValue value)
    {{
        if (value.S is not null) return JsonValue.Create(value.S);
        if (value.N is not null) return new JsonObject {{ ["$number"] = value.N }};
        if (value.B is not null) return new JsonObject {{ ["$binary"] = Convert.ToBase64String(value.B.ToArray()) }};
        if (value.BOOL.HasValue) return JsonValue.Create(value.BOOL.Value);
        if (value.NULL.HasValue && value.NULL.Value) return null;
        if (value.IsMSet) return new JsonObject(value.M.ToDictionary(item => item.Key, item => ToNode(item.Value)));
        if (value.IsLSet) return new JsonArray(value.L.Select(ToNode).ToArray());
        if (value.IsSSSet) return new JsonObject {{ ["$stringSet"] = new JsonArray(value.SS.Select(item => JsonValue.Create(item)).ToArray()) }};
        if (value.IsNSSet) return new JsonObject {{ ["$numberSet"] = new JsonArray(value.NS.Select(item => JsonValue.Create(item)).ToArray()) }};
        if (value.IsBSSet) return new JsonObject
        {{
            ["$binarySet"] = new JsonArray(value.BS.Select(item => JsonValue.Create(Convert.ToBase64String(item.ToArray()))).ToArray()),
        }};
        return null;
    }}

    private static AttributeValue FromJsonValue(JsonElement value)
    {{
        switch (value.ValueKind)
        {{
            case JsonValueKind.Null: return new AttributeValue {{ NULL = true }};
            case JsonValueKind.True: return new AttributeValue {{ BOOL = true }};
            case JsonValueKind.False: return new AttributeValue {{ BOOL = false }};
            case JsonValueKind.String: return new AttributeValue {{ S = value.GetString() }};
            case JsonValueKind.Number: return new AttributeValue {{ N = value.GetRawText() }};
            case JsonValueKind.Array:
                return new AttributeValue {{ L = value.EnumerateArray().Select(FromJsonValue).ToList() }};
            case JsonValueKind.Object:
                if (value.EnumerateObject().Count() == 1)
                {{
                    if (value.TryGetProperty("$number", out var number))
                        return new AttributeValue {{ N = RequiredString(number, "$number") }};
                    if (value.TryGetProperty("$binary", out var binary))
                        return new AttributeValue {{ B = new MemoryStream(Convert.FromBase64String(RequiredString(binary, "$binary"))) }};
                    if (value.TryGetProperty("$stringSet", out var stringSet))
                        return new AttributeValue {{ SS = RequiredStrings(stringSet, "$stringSet") }};
                    if (value.TryGetProperty("$numberSet", out var numberSet))
                        return new AttributeValue {{ NS = RequiredStrings(numberSet, "$numberSet") }};
                    if (value.TryGetProperty("$binarySet", out var binarySet))
                        return new AttributeValue
                        {{
                            BS = RequiredStrings(binarySet, "$binarySet")
                                .Select(item => new MemoryStream(Convert.FromBase64String(item)))
                                .ToList(),
                        }};
                }}
                return new AttributeValue
                {{
                    M = value.EnumerateObject().ToDictionary(
                        property => property.Name,
                        property => FromJsonValue(property.Value)),
                }};
            default: throw RepositoryException.Invalid("Unsupported JSON value.");
        }}
    }}

    private static string RequiredString(JsonElement value, string tag) =>
        value.ValueKind == JsonValueKind.String
            ? value.GetString()!
            : throw RepositoryException.Invalid($"{{tag}} must contain a string.");

    private static List<string> RequiredStrings(JsonElement value, string tag)
    {{
        if (value.ValueKind != JsonValueKind.Array)
            throw RepositoryException.Invalid($"{{tag}} must contain an array of strings.");
        var values = value.EnumerateArray().Select(item => RequiredString(item, tag)).ToList();
        if (values.Count == 0)
            throw RepositoryException.Invalid($"{{tag}} cannot be empty.");
        return values;
    }}
}}
"#,
        namespace = spec.namespace,
        health_checks = health_checks,
        methods = methods,
    )
}

fn resource_methods(resource: &ProjectResourceModel, protocol: &str) -> String {
    let base = pascal_case(&resource.endpoint_slug);
    let table = csharp_string_literal(&resource.table_name);
    let output_type = if protocol == "graphql" {
        resource.model_name.clone()
    } else {
        "JsonElement".into()
    };
    let convert = if protocol == "graphql" {
        format!(
            "{}.FromDocument(DynamoDocumentCodec.ToJson(document))",
            resource.model_name
        )
    } else {
        "DynamoDocumentCodec.ToJson(document)".into()
    };
    let schema = key_schema_csharp(resource);
    let partition_key = resource
        .primary_fields
        .first()
        .map(|field| field.source_name.as_str())
        .unwrap_or("id");
    let mut output = format!(
        r#"    public async Task<IReadOnlyList<{output_type}>> Search{base}Async(int limit)
    {{
        try
        {{
            var response = await client.ScanAsync(new ScanRequest
            {{
                TableName = {table},
                Limit = Math.Clamp(limit, 1, 1_000),
                ConsistentRead = false,
            }});
            return response.Items.Select(document => {convert}).ToArray();
        }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

    public async Task<{output_type}> Get{base}Async(string identity)
    {{
        var key = DynamoDocumentCodec.ExactKey(identity, {schema});
        try
        {{
            var response = await client.GetItemAsync(new GetItemRequest
            {{
                TableName = {table},
                Key = key,
                ConsistentRead = true,
            }});
            var document = response.Item is {{ Count: > 0 }}
                ? response.Item
                : throw RepositoryException.NotFound("DynamoDB item was not found.");
            return {convert};
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

"#,
        output_type = output_type,
        base = base,
        table = table,
        convert = convert,
        schema = schema,
    );
    if resource.mode != ProjectResourceMode::Crud {
        return output;
    }
    let _ = write!(
        output,
        r##"    public async Task<{output_type}> Create{base}Async(JsonElement values)
    {{
        var document = DynamoDocumentCodec.FromJson(values);
        foreach (var key in {schema})
        {{
            if (!document.TryGetValue(key.Name, out var value))
                throw RepositoryException.Invalid($"Missing DynamoDB key `{{key.Name}}`.");
            DynamoDocumentCodec.ValidateKeyType(key.Name, key.Type, value);
        }}
        try
        {{
            await client.PutItemAsync(new PutItemRequest
            {{
                TableName = {table},
                Item = document,
                ConditionExpression = "attribute_not_exists(#pk)",
                ExpressionAttributeNames = new Dictionary<string, string> {{ ["#pk"] = {partition_key} }},
            }});
            return {convert};
        }}
        catch (ConditionalCheckFailedException)
        {{
            throw RepositoryException.Invalid("A DynamoDB item with this key already exists.");
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

    public async Task<{output_type}> Update{base}Async(string identity, JsonElement values)
    {{
        var key = DynamoDocumentCodec.ExactKey(identity, {schema});
        var changes = DynamoDocumentCodec.FromJson(values);
        foreach (var keyField in {schema})
        {{
            if (changes.Remove(keyField.Name))
                throw RepositoryException.Invalid("DynamoDB patches cannot change key fields.");
        }}
        if (changes.Count == 0)
            throw RepositoryException.Invalid("Patch values cannot be empty.");
        var names = changes.Keys.Select((name, index) => (name, token: $"#f{{index}}"))
            .ToDictionary(item => item.token, item => item.name);
        var expressionValues = changes.Values.Select((value, index) => (value, token: $":v{{index}}"))
            .ToDictionary(item => item.token, item => item.value);
        var assignments = names.Keys.Zip(expressionValues.Keys, (name, value) => $"{{name}} = {{value}}");
        names["#pk"] = {partition_key};
        try
        {{
            var response = await client.UpdateItemAsync(new UpdateItemRequest
            {{
                TableName = {table},
                Key = key,
                UpdateExpression = $"SET {{string.Join(", ", assignments)}}",
                ConditionExpression = "attribute_exists(#pk)",
                ExpressionAttributeNames = names,
                ExpressionAttributeValues = expressionValues,
                ReturnValues = ReturnValue.ALL_NEW,
            }});
            var document = response.Attributes;
            return {convert};
        }}
        catch (ConditionalCheckFailedException)
        {{
            throw RepositoryException.NotFound("DynamoDB item was not found.");
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

    public async Task<JsonElement> Delete{base}Async(string identity)
    {{
        var key = DynamoDocumentCodec.ExactKey(identity, {schema});
        try
        {{
            var response = await client.DeleteItemAsync(new DeleteItemRequest
            {{
                TableName = {table},
                Key = key,
                ConditionExpression = "attribute_exists(#pk)",
                ExpressionAttributeNames = new Dictionary<string, string> {{ ["#pk"] = {partition_key} }},
                ReturnValues = ReturnValue.ALL_OLD,
            }});
            return response.Attributes is {{ Count: > 0 }}
                ? DynamoDocumentCodec.ToJson(response.Attributes)
                : throw RepositoryException.NotFound("DynamoDB item was not found.");
        }}
        catch (ConditionalCheckFailedException)
        {{
            throw RepositoryException.NotFound("DynamoDB item was not found.");
        }}
        catch (RepositoryException) {{ throw; }}
        catch (Exception error) {{ throw RepositoryException.Datastore(error); }}
    }}

"##,
        output_type = output_type,
        base = base,
        schema = schema,
        table = table,
        partition_key = csharp_string_literal(partition_key),
        convert = convert,
    );
    output
}

fn key_schema_csharp(resource: &ProjectResourceModel) -> String {
    format!(
        "new (string Name, string Type)[] {{ {} }}",
        resource
            .primary_fields
            .iter()
            .map(|field| format!(
                "({}, {})",
                csharp_string_literal(&field.source_name),
                csharp_string_literal(&field.data_type)
            ))
            .collect::<Vec<_>>()
            .join(", ")
    )
}
