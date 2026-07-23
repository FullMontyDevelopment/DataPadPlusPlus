use std::fmt::Write as _;

use super::*;

pub(super) struct DotnetClientProfile {
    pub(super) provider_namespace: &'static str,
    pub(super) factory_body: &'static str,
    pub(super) factory_definition: &'static str,
}

pub(super) fn render_client_files(
    spec: &ProjectExportSpec,
    adapter: &ProjectExportClientAdapter,
    profile: DotnetClientProfile,
) -> Vec<ProjectFile> {
    let root = safe_file_stem(&spec.project_name);
    vec![
        project_file(&root, "DatastoreClient.cs", dotnet_client(spec, &profile)),
        project_file(
            &root,
            "DatastoreRepository.cs",
            dotnet_repository(spec, adapter),
        ),
    ]
}

fn dotnet_client(spec: &ProjectExportSpec, profile: &DotnetClientProfile) -> String {
    format!(
        r#"using System.Data.Common;
using {provider_namespace};

namespace {namespace};

public interface IDatastoreConnectionFactory
{{
    DbConnection CreateConnection();
}}

public static class DatastoreClientRegistration
{{
    public static IServiceCollection AddDatastoreClient(
        this IServiceCollection services,
        IConfiguration configuration)
    {{
        var connectionString = configuration.GetConnectionString("Datastore");
        if (string.IsNullOrWhiteSpace(connectionString))
        {{
            throw new InvalidOperationException(
                "Set ConnectionStrings:Datastore or ConnectionStrings__Datastore before starting the API.");
        }}

        services.AddSingleton<IDatastoreConnectionFactory>(_ =>
        {{
            {factory_body}
        }});
        services.AddTransient<DatastoreRepository>();
        return services;
    }}
}}

{factory_definition}
"#,
        provider_namespace = profile.provider_namespace,
        namespace = spec.namespace,
        factory_body = profile.factory_body,
        factory_definition = profile.factory_definition,
    )
}

fn dotnet_repository(spec: &ProjectExportSpec, adapter: &ProjectExportClientAdapter) -> String {
    let mut methods = String::new();
    for resource in &spec.resources {
        methods.push_str(&dotnet_resource_methods(resource, adapter));
    }
    for endpoint in &spec.custom_endpoints {
        methods.push_str(&dotnet_custom_endpoint_method(endpoint));
    }

    format!(
        r#"using System.Collections;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using Dapper;

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
        new("datastore", "The datastore operation failed.", inner);
}}

public sealed class DatastoreRepository(IDatastoreConnectionFactory connections)
{{
    public async Task PingAsync(CancellationToken cancellationToken = default)
    {{
        try
        {{
            await using var connection = connections.CreateConnection();
            await connection.OpenAsync(cancellationToken);
            await connection.ExecuteScalarAsync<int>(
                new CommandDefinition("SELECT 1", cancellationToken: cancellationToken));
        }}
        catch (Exception error) when (error is not RepositoryException)
        {{
            throw RepositoryException.Unavailable("Datastore health check failed.", error);
        }}
    }}
{methods}
    private static JsonElement RequireObject(JsonElement value, string label)
    {{
        if (value.ValueKind != JsonValueKind.Object)
        {{
            throw RepositoryException.Invalid($"{{label}} must be a JSON object.");
        }}
        return value;
    }}

    private static void EnsureKnownFields(JsonElement values, IReadOnlySet<string> allowed)
    {{
        foreach (var property in values.EnumerateObject())
        {{
            if (!allowed.Contains(property.Name))
            {{
                throw RepositoryException.Invalid($"Field `{{property.Name}}` is not writable.");
            }}
        }}
    }}

    private static object? FieldValue<T>(JsonElement value, string field, bool nullable)
    {{
        if (value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {{
            if (!nullable)
            {{
                throw RepositoryException.Invalid($"Field `{{field}}` cannot be null.");
            }}
            return null;
        }}

        try
        {{
            if (value.ValueKind == JsonValueKind.String && typeof(T) != typeof(string))
            {{
                var text = value.GetString();
                if (typeof(T) == typeof(Guid))
                {{
                    return Guid.Parse(text!);
                }}
                if (typeof(T) == typeof(DateOnly))
                {{
                    return DateOnly.Parse(text!, CultureInfo.InvariantCulture);
                }}
                if (typeof(T) == typeof(TimeOnly))
                {{
                    return TimeOnly.Parse(text!, CultureInfo.InvariantCulture);
                }}
                if (typeof(T) == typeof(DateTime))
                {{
                    return DateTime.Parse(text!, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
                }}
                if (typeof(T) == typeof(DateTimeOffset))
                {{
                    return DateTimeOffset.Parse(text!, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
                }}
                return Convert.ChangeType(text, typeof(T), CultureInfo.InvariantCulture);
            }}
            return JsonSerializer.Deserialize<T>(value.GetRawText());
        }}
        catch (Exception error)
        {{
            throw RepositoryException.Invalid($"Field `{{field}}` is invalid: {{error.Message}}");
        }}
    }}

    private static T IdentityValue<T>(string identity, string field, bool composite)
    {{
        try
        {{
            if (composite)
            {{
                using var document = JsonDocument.Parse(identity);
                if (!document.RootElement.TryGetProperty(field, out var component))
                {{
                    throw RepositoryException.Invalid($"Composite identity is missing `{{field}}`.");
                }}
                return (T)FieldValue<T>(component, field, false)!;
            }}

            try
            {{
                using var document = JsonDocument.Parse(identity);
                return (T)FieldValue<T>(document.RootElement, field, false)!;
            }}
            catch (JsonException)
            {{
                if (typeof(T) == typeof(string))
                {{
                    return (T)(object)identity;
                }}
                return (T)Convert.ChangeType(identity, typeof(T), CultureInfo.InvariantCulture);
            }}
        }}
        catch (RepositoryException)
        {{
            throw;
        }}
        catch (Exception error)
        {{
            throw RepositoryException.Invalid($"Identity field `{{field}}` is invalid: {{error.Message}}");
        }}
    }}

    private static object? EndpointParameter(
        JsonElement parameters,
        string name,
        string parameterType,
        bool required)
    {{
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(name, out var value) ||
            value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {{
            if (required)
            {{
                throw RepositoryException.Invalid($"Custom endpoint parameter `{{name}}` is required.");
            }}
            return null;
        }}

        try
        {{
            return parameterType switch
            {{
                "number" when value.ValueKind == JsonValueKind.String =>
                    double.Parse(value.GetString()!, CultureInfo.InvariantCulture),
                "number" => value.GetDouble(),
                "boolean" when value.ValueKind == JsonValueKind.String =>
                    bool.Parse(value.GetString()!),
                "boolean" => value.GetBoolean(),
                "json" => value.GetRawText(),
                _ => value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString(),
            }};
        }}
        catch (Exception error)
        {{
            throw RepositoryException.Invalid(
                $"Custom endpoint parameter `{{name}}` is invalid: {{error.Message}}");
        }}
    }}

    private static IReadOnlyList<IReadOnlyDictionary<string, object?>> NormalizeRows(
        IEnumerable<dynamic> rows) =>
        rows.Select(row =>
        {{
            var values = (IDictionary<string, object?>)row;
            return (IReadOnlyDictionary<string, object?>)values.ToDictionary(
                item => item.Key,
                item => NormalizeValue(item.Value));
        }}).ToArray();

    private static object? NormalizeValue(object? value) => value switch
    {{
        null or DBNull => null,
        byte[] bytes => Convert.ToBase64String(bytes),
        DateTime dateTime => dateTime.ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("O", CultureInfo.InvariantCulture),
        DateOnly date => date.ToString("O", CultureInfo.InvariantCulture),
        TimeOnly time => time.ToString("O", CultureInfo.InvariantCulture),
        Guid guid => guid.ToString(),
        IDictionary dictionary => dictionary.Cast<DictionaryEntry>()
            .ToDictionary(item => item.Key.ToString()!, item => NormalizeValue(item.Value)),
        IEnumerable enumerable when value is not string =>
            enumerable.Cast<object?>().Select(NormalizeValue).ToArray(),
        _ => value,
    }};
}}
"#,
        namespace = spec.namespace,
        methods = methods,
    )
}

fn dotnet_resource_methods(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
) -> String {
    let base = pascal_case(&resource.endpoint_slug);
    let select = dotnet_select_list(resource, adapter);
    let mut output = format!(
        r#"
    public async Task<IReadOnlyList<{model}>> Search{base}Async(int limit)
    {{
        try
        {{
            await using var connection = connections.CreateConnection();
            var rows = await connection.QueryAsync<{model}>(
                {query},
                new {{ Limit = Math.Clamp(limit, 1, 500) }});
            return rows.AsList();
        }}
        catch (Exception error) when (error is not RepositoryException)
        {{
            throw RepositoryException.Datastore(error);
        }}
    }}
"#,
        model = resource.model_name,
        base = base,
        query = csharp_string_literal(&format!(
            "SELECT {select} FROM {} LIMIT @Limit",
            resource.qualified_target
        )),
    );

    if !resource.primary_fields.is_empty() {
        let parameters = dotnet_identity_parameters(resource, "parameters");
        let where_clause = dotnet_identity_where(resource, adapter, "id");
        let _ = write!(
            output,
            r#"
    public async Task<{model}?> Get{base}Async(string identity)
    {{
        try
        {{
            var parameters = new DynamicParameters();
{parameters}            await using var connection = connections.CreateConnection();
            return await connection.QuerySingleOrDefaultAsync<{model}>(
                {query},
                parameters) ?? throw RepositoryException.NotFound(
                    "The requested resource was not found.");
        }}
        catch (Exception error) when (error is not RepositoryException)
        {{
            throw RepositoryException.Datastore(error);
        }}
    }}
"#,
            model = resource.model_name,
            base = base,
            parameters = parameters,
            query = csharp_string_literal(&format!(
                "SELECT {select} FROM {} WHERE {where_clause}",
                resource.qualified_target
            )),
        );
    }

    if resource.mode == ProjectResourceMode::Crud {
        output.push_str(&dotnet_create_method(resource, adapter));
        output.push_str(&dotnet_update_method(resource, adapter));
        output.push_str(&dotnet_delete_method(resource, adapter));
    }
    output
}

fn dotnet_create_method(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
) -> String {
    let base = pascal_case(&resource.endpoint_slug);
    let allowed = dotnet_hash_set(resource.fields.iter().map(|field| field.json_name.as_str()));
    let fields = resource
        .fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            format!(
                r#"            if (values.TryGetProperty({json_name}, out var value{index}))
            {{
                columns.Add({column});
                placeholders.Add({placeholder});
                parameters.Add("v{index}", FieldValue<{field_type}>(value{index}, {json_name}, {nullable}));
            }}
"#,
                json_name = csharp_string_literal(&field.json_name),
                column = csharp_string_literal(
                    &(adapter.sql.expect("SQL adapter").quote_identifier)(&field.source_name)
                        .unwrap_or_default()
                ),
                placeholder = csharp_string_literal(&format!("@v{index}")),
                field_type = field.csharp_base_type,
                nullable = field.nullable.to_string().to_ascii_lowercase(),
            )
        })
        .collect::<String>();
    format!(
        r#"
    public async Task<{model}> Create{base}Async(JsonElement input)
    {{
        try
        {{
            var values = RequireObject(input, "Mutation values");
            EnsureKnownFields(values, {allowed});
            var columns = new List<string>();
            var placeholders = new List<string>();
            var parameters = new DynamicParameters();
{fields}            var statement = columns.Count == 0
                ? {default_insert}
                : {insert_prefix} + string.Join(", ", columns) + ") VALUES (" +
                  string.Join(", ", placeholders) + ")";
            statement += {returning};
            await using var connection = connections.CreateConnection();
            return await connection.QuerySingleAsync<{model}>(statement, parameters);
        }}
        catch (Exception error) when (error is not RepositoryException)
        {{
            throw RepositoryException.Datastore(error);
        }}
    }}
"#,
        model = resource.model_name,
        base = base,
        allowed = allowed,
        fields = fields,
        default_insert = csharp_string_literal(&format!(
            "INSERT INTO {} DEFAULT VALUES",
            resource.qualified_target
        )),
        insert_prefix =
            csharp_string_literal(&format!("INSERT INTO {} (", resource.qualified_target)),
        returning = csharp_string_literal(&format!(
            " RETURNING {}",
            dotnet_select_list(resource, adapter)
        )),
    )
}

fn dotnet_update_method(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
) -> String {
    let base = pascal_case(&resource.endpoint_slug);
    let fields = resource
        .fields
        .iter()
        .filter(|field| !field.primary)
        .collect::<Vec<_>>();
    let allowed = dotnet_hash_set(fields.iter().map(|field| field.json_name.as_str()));
    let assignments = fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            format!(
                r#"            if (values.TryGetProperty({json_name}, out var value{index}))
            {{
                assignments.Add({assignment});
                parameters.Add("v{index}", FieldValue<{field_type}>(value{index}, {json_name}, {nullable}));
            }}
"#,
                json_name = csharp_string_literal(&field.json_name),
                assignment = csharp_string_literal(&format!(
                    "{} = @v{index}",
                    (adapter.sql.expect("SQL adapter").quote_identifier)(&field.source_name)
                        .unwrap_or_default()
                )),
                field_type = field.csharp_base_type,
                nullable = field.nullable.to_string().to_ascii_lowercase(),
            )
        })
        .collect::<String>();
    let identity_parameters = dotnet_identity_parameters(resource, "parameters");
    let where_clause = dotnet_identity_where(resource, adapter, "id");
    format!(
        r#"
    public async Task<{model}> Update{base}Async(string identity, JsonElement input)
    {{
        try
        {{
            var values = RequireObject(input, "Mutation values");
            EnsureKnownFields(values, {allowed});
            var assignments = new List<string>();
            var parameters = new DynamicParameters();
{assignments}            if (assignments.Count == 0)
            {{
                throw RepositoryException.Invalid("PATCH requires at least one writable field.");
            }}
{identity_parameters}            var statement = {update_prefix} + string.Join(", ", assignments) +
                {where_clause} + {returning};
            await using var connection = connections.CreateConnection();
            var updated = await connection.QuerySingleOrDefaultAsync<{model}>(statement, parameters);
            return updated ?? throw RepositoryException.NotFound("The requested resource was not found.");
        }}
        catch (Exception error) when (error is not RepositoryException)
        {{
            throw RepositoryException.Datastore(error);
        }}
    }}
"#,
        model = resource.model_name,
        base = base,
        allowed = allowed,
        assignments = assignments,
        identity_parameters = identity_parameters,
        update_prefix =
            csharp_string_literal(&format!("UPDATE {} SET ", resource.qualified_target)),
        where_clause = csharp_string_literal(&format!(" WHERE {where_clause}")),
        returning = csharp_string_literal(&format!(
            " RETURNING {}",
            dotnet_select_list(resource, adapter)
        )),
    )
}

fn dotnet_delete_method(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
) -> String {
    let base = pascal_case(&resource.endpoint_slug);
    let identity_parameters = dotnet_identity_parameters(resource, "parameters");
    let where_clause = dotnet_identity_where(resource, adapter, "id");
    format!(
        r#"
    public async Task<object> Delete{base}Async(string identity)
    {{
        try
        {{
            var parameters = new DynamicParameters();
{identity_parameters}            await using var connection = connections.CreateConnection();
            var deleted = await connection.ExecuteAsync({query}, parameters);
            if (deleted == 0)
            {{
                throw RepositoryException.NotFound("The requested resource was not found.");
            }}
            return new {{ deleted = true, identity }};
        }}
        catch (Exception error) when (error is not RepositoryException)
        {{
            throw RepositoryException.Datastore(error);
        }}
    }}
"#,
        base = base,
        identity_parameters = identity_parameters,
        query = csharp_string_literal(&format!(
            "DELETE FROM {} WHERE {where_clause}",
            resource.qualified_target
        )),
    )
}

fn dotnet_custom_endpoint_method(endpoint: &ProjectCustomEndpoint) -> String {
    let name = pascal_case(&endpoint.function_name);
    let parameters = endpoint
        .parameters
        .iter()
        .enumerate()
        .map(|(index, parameter)| {
            format!(
                "            arguments.Add(\"p{index}\", EndpointParameter(parameters, {name}, {parameter_type}, {required}));\n",
                name = csharp_string_literal(&parameter.name),
                parameter_type = csharp_string_literal(&parameter.parameter_type),
                required = parameter.required.to_string().to_ascii_lowercase(),
            )
        })
        .collect::<String>();
    format!(
        r#"
    public async Task<IReadOnlyList<IReadOnlyDictionary<string, object?>>> Run{name}Async(
        JsonElement parameters)
    {{
        try
        {{
            RequireObject(parameters, "Custom endpoint parameters");
            var arguments = new DynamicParameters();
{parameters}            await using var connection = connections.CreateConnection();
            var rows = await connection.QueryAsync({query}, arguments);
            return NormalizeRows(rows);
        }}
        catch (Exception error) when (error is not RepositoryException)
        {{
            throw RepositoryException.Datastore(error);
        }}
    }}
"#,
        name = name,
        parameters = parameters,
        query = csharp_string_literal(&endpoint.parameterized_query),
    )
}

fn dotnet_select_list(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
) -> String {
    resource
        .fields
        .iter()
        .map(|field| {
            (adapter.sql.expect("SQL adapter").select_expression)(
                &field.source_name,
                &field.csharp_name,
                field.writable,
            )
            .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn dotnet_identity_parameters(resource: &ProjectResourceModel, variable: &str) -> String {
    let composite = resource.primary_fields.len() > 1;
    resource
        .primary_fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            format!(
                "            {variable}.Add(\"id{index}\", IdentityValue<{field_type}>(identity, {field_name}, {composite}));\n",
                field_type = field.csharp_base_type,
                field_name = csharp_string_literal(&field.source_name),
                composite = composite.to_string().to_ascii_lowercase(),
            )
        })
        .collect()
}

fn dotnet_identity_where(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
    prefix: &str,
) -> String {
    resource
        .primary_fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            format!(
                "{} = @{prefix}{index}",
                (adapter.sql.expect("SQL adapter").quote_identifier)(&field.source_name)
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn dotnet_hash_set<'a>(values: impl Iterator<Item = &'a str>) -> String {
    format!(
        "new HashSet<string>(StringComparer.Ordinal) {{ {} }}",
        values
            .map(csharp_string_literal)
            .collect::<Vec<_>>()
            .join(", ")
    )
}
