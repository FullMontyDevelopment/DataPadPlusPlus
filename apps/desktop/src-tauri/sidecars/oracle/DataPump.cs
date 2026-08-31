using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Oracle.ManagedDataAccess.Client;
using Oracle.ManagedDataAccess.Types;

namespace DataPadPlusPlus.OracleSidecar;

internal static partial class Program
{
    private static async Task<object> ExecuteDataPumpAsync(
        OracleRequest request,
        ActiveRequest active,
        bool importing,
        CancellationToken cancellationToken)
    {
        if (request.ReadOnly && importing)
        {
            throw new SidecarException("oracle-read-only-blocked", "This Oracle connection is read-only, so Data Pump import is unavailable.");
        }
        if (!string.Equals(request.ConflictPolicy, "fail", StringComparison.OrdinalIgnoreCase))
        {
            throw new SidecarException("oracle-datapump-conflict-policy-invalid", "Oracle Data Pump requires the fail-safe conflict policy.");
        }

        var directoryName = RequiredDataPumpIdentifier(request.DirectoryName, "directory object");
        var dumpFileName = RequiredDataPumpFileName(request.DumpFileName);
        var scope = string.Equals(request.DataPumpScope, "table", StringComparison.OrdinalIgnoreCase) ? "table" : "schema";
        var sourceSchema = RequiredDataPumpIdentifier(request.SourceSchema, "source schema");
        var tableName = scope == "table" ? RequiredDataPumpIdentifier(request.Table, "table") : null;
        var targetSchema = importing
            ? RequiredDataPumpIdentifier(request.TargetSchema, "target schema")
            : sourceSchema;
        var targetTable = importing && scope == "table"
            ? RequiredDataPumpIdentifier(request.TargetTable ?? tableName, "target table")
            : tableName;
        var input = RequiredConnection(request);
        var started = Stopwatch.StartNew();

        await using var connection = BuildConnection(input);
        await connection.OpenAsync(cancellationToken);
        ApplySessionIdentity(connection, input);
        await ApplyCurrentSchemaAsync(connection, request, active, cancellationToken);
        await EnsureDataPumpDirectoryAsync(connection, directoryName, request, active, cancellationToken);

        if (importing)
        {
            await EnsureDataPumpSourceExistsAsync(connection, directoryName, dumpFileName, request, active, cancellationToken);
            await EnsureDataPumpTargetIsEmptyAsync(
                connection,
                scope,
                targetSchema,
                targetTable,
                request,
                active,
                cancellationToken);
        }
        else
        {
            await EnsureDataPumpTargetDoesNotExistAsync(connection, directoryName, dumpFileName, request, active, cancellationToken);
        }

        var jobName = $"DPP_{(importing ? "IMP" : "EXP")}_{Guid.NewGuid():N}"[..30].ToUpperInvariant();
        var logFileName = $"{Path.GetFileNameWithoutExtension(dumpFileName)}-{jobName.ToLowerInvariant()}.log";
        var state = await RunDataPumpJobAsync(
            connection,
            importing,
            scope,
            directoryName,
            dumpFileName,
            logFileName,
            jobName,
            sourceSchema,
            targetSchema,
            tableName,
            targetTable,
            request,
            active,
            cancellationToken);

        if (!string.Equals(state, "COMPLETED", StringComparison.OrdinalIgnoreCase))
        {
            throw new SidecarException("oracle-datapump-job-incomplete", $"Oracle Data Pump job {jobName} ended in state {state}.");
        }

        var (artifactExists, artifactBytes) = await DataPumpFileStatusAsync(
            connection,
            directoryName,
            dumpFileName,
            request,
            active,
            cancellationToken);
        if (!artifactExists)
        {
            throw new SidecarException("oracle-datapump-artifact-missing", "Oracle Data Pump completed without a readable dump artifact in the selected directory object.");
        }

        var importedObjectCount = importing
            ? await DataPumpTargetObjectCountAsync(connection, scope, targetSchema, targetTable, request, active, cancellationToken)
            : 0;
        if (importing && importedObjectCount == 0)
        {
            throw new SidecarException("oracle-datapump-import-empty", "Oracle Data Pump reported completion but no target objects were found.");
        }

        return new
        {
            workflow = importing ? "oracle.datapump.restore" : "oracle.datapump.backup",
            format = "datapump",
            scope,
            directoryName,
            dumpFileName,
            logFileName,
            jobName,
            jobState = state,
            sourceSchema,
            targetSchema = importing ? targetSchema : null,
            table = tableName,
            targetTable = importing ? targetTable : null,
            artifactBytes,
            importedObjectCount = importing ? importedObjectCount : (long?)null,
            conflictPolicy = "fail",
            durationMs = started.ElapsedMilliseconds,
        };
    }

    private static async Task<string> RunDataPumpJobAsync(
        OracleConnection connection,
        bool importing,
        string scope,
        string directoryName,
        string dumpFileName,
        string logFileName,
        string jobName,
        string sourceSchema,
        string targetSchema,
        string? tableName,
        string? targetTable,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        var operation = importing ? "IMPORT" : "EXPORT";
        var jobMode = scope.ToUpperInvariant();
        var filters = $"dbms_datapump.metadata_filter(handle, 'SCHEMA_EXPR', {DataPumpSqlLiteral($"IN ('{sourceSchema}')")});";
        if (scope == "table")
        {
            filters += $"\n  dbms_datapump.metadata_filter(handle, 'NAME_EXPR', {DataPumpSqlLiteral($"IN ('{tableName}')")});";
        }
        var remaps = string.Empty;
        if (importing && !string.Equals(sourceSchema, targetSchema, StringComparison.Ordinal))
        {
            remaps += $"\n  dbms_datapump.metadata_remap(handle, 'REMAP_SCHEMA', {DataPumpSqlLiteral(sourceSchema)}, {DataPumpSqlLiteral(targetSchema)});";
        }
        if (importing && scope == "table" && !string.Equals(tableName, targetTable, StringComparison.Ordinal))
        {
            remaps += $"\n  dbms_datapump.metadata_remap(handle, 'REMAP_TABLE', {DataPumpSqlLiteral(tableName!)}, {DataPumpSqlLiteral(targetTable!)});";
        }

        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        command.CommandText = $"""
            declare
              handle number := null;
              job_state varchar2(30);
              failure_message varchar2(2000);
              failure_stage varchar2(30) := 'open';
            begin
              handle := dbms_datapump.open(
                operation => {DataPumpSqlLiteral(operation)},
                job_mode => {DataPumpSqlLiteral(jobMode)},
                remote_link => null,
                job_name => {DataPumpSqlLiteral(jobName)},
                version => 'COMPATIBLE');
              failure_stage := 'add dump file';
              dbms_datapump.add_file(handle, {DataPumpSqlLiteral(dumpFileName)}, {DataPumpSqlLiteral(directoryName)}, filetype => dbms_datapump.ku$_file_type_dump_file, reusefile => 0);
              failure_stage := 'add log file';
              dbms_datapump.add_file(handle, {DataPumpSqlLiteral(logFileName)}, {DataPumpSqlLiteral(directoryName)}, filetype => dbms_datapump.ku$_file_type_log_file, reusefile => 1);
              failure_stage := 'metadata filters';
              {filters}
              {remaps}
              failure_stage := 'start job';
              dbms_datapump.start_job(handle);
              failure_stage := 'wait for job';
              dbms_datapump.wait_for_job(handle, job_state);
              :jobState := job_state;
            exception
              when others then
                failure_message := failure_stage || ': ' || sqlerrm;
                if handle is not null then
                  begin
                    dbms_datapump.stop_job(handle, 1, 0);
                  exception when others then null;
                  end;
                end if;
                raise_application_error(-20001, failure_message, true);
            end;
            """;
        var state = new OracleParameter("jobState", OracleDbType.Varchar2, 30, null, ParameterDirection.Output);
        command.Parameters.Add(state);
        active.SetCommand(command);
        await command.ExecuteNonQueryAsync(cancellationToken);
        return Convert.ToString(state.Value, CultureInfo.InvariantCulture)?.Trim() ?? "UNKNOWN";
    }

    private static async Task EnsureDataPumpDirectoryAsync(
        OracleConnection connection,
        string directoryName,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.CommandText = "select count(*) from all_directories where directory_name = :directory_name";
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        command.Parameters.Add("directory_name", OracleDbType.Varchar2, directoryName, ParameterDirection.Input);
        active.SetCommand(command);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture) == 0)
        {
            throw new SidecarException("oracle-datapump-directory-unavailable", "The Oracle directory object is missing or the connected user cannot access it.");
        }
    }

    private static async Task EnsureDataPumpTargetIsEmptyAsync(
        OracleConnection connection,
        string scope,
        string targetSchema,
        string? targetTable,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        if (scope == "schema")
        {
            command.CommandText = "select count(*) from all_objects where owner = :owner and object_name not like 'BIN$%'";
            command.Parameters.Add("owner", OracleDbType.Varchar2, targetSchema, ParameterDirection.Input);
        }
        else
        {
            command.CommandText = "select count(*) from all_objects where owner = :owner and object_name = :object_name and object_type in ('TABLE', 'VIEW', 'MATERIALIZED VIEW')";
            command.Parameters.Add("owner", OracleDbType.Varchar2, targetSchema, ParameterDirection.Input);
            command.Parameters.Add("object_name", OracleDbType.Varchar2, targetTable, ParameterDirection.Input);
        }
        active.SetCommand(command);
        var count = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
        if (count != 0)
        {
            throw new SidecarException("oracle-datapump-target-not-empty", scope == "schema"
                ? "Oracle Data Pump restore requires an existing empty target schema."
                : "Oracle Data Pump restore requires a target table name that does not exist.");
        }
    }

    private static async Task<long> DataPumpTargetObjectCountAsync(
        OracleConnection connection,
        string scope,
        string targetSchema,
        string? targetTable,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        command.CommandText = scope == "schema"
            ? "select count(*) from all_objects where owner = :owner and object_name not like 'BIN$%'"
            : "select count(*) from all_objects where owner = :owner and object_name = :object_name and object_type = 'TABLE'";
        command.Parameters.Add("owner", OracleDbType.Varchar2, targetSchema, ParameterDirection.Input);
        if (scope == "table") command.Parameters.Add("object_name", OracleDbType.Varchar2, targetTable, ParameterDirection.Input);
        active.SetCommand(command);
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
    }

    private static async Task EnsureDataPumpTargetDoesNotExistAsync(
        OracleConnection connection,
        string directoryName,
        string dumpFileName,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        var (exists, _) = await DataPumpFileStatusAsync(connection, directoryName, dumpFileName, request, active, cancellationToken);
        if (exists)
        {
            throw new SidecarException("oracle-datapump-target-exists", "The Oracle Data Pump dump file already exists. Choose a new file name; existing artifacts are never overwritten.");
        }
    }

    private static async Task EnsureDataPumpSourceExistsAsync(
        OracleConnection connection,
        string directoryName,
        string dumpFileName,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        var (exists, _) = await DataPumpFileStatusAsync(connection, directoryName, dumpFileName, request, active, cancellationToken);
        if (!exists)
        {
            throw new SidecarException("oracle-datapump-source-missing", "The Oracle Data Pump dump file does not exist in the selected directory object.");
        }
    }

    private static async Task<(bool Exists, long Bytes)> DataPumpFileStatusAsync(
        OracleConnection connection,
        string directoryName,
        string dumpFileName,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        command.CommandText = "begin utl_file.fgetattr(:directory_name, :file_name, :file_exists, :file_length, :block_size); end;";
        command.Parameters.Add("directory_name", OracleDbType.Varchar2, directoryName, ParameterDirection.Input);
        command.Parameters.Add("file_name", OracleDbType.Varchar2, dumpFileName, ParameterDirection.Input);
        var exists = new OracleParameter("file_exists", OracleDbType.Boolean, ParameterDirection.Output);
        var length = new OracleParameter("file_length", OracleDbType.Int64, ParameterDirection.Output);
        var blockSize = new OracleParameter("block_size", OracleDbType.Int64, ParameterDirection.Output);
        command.Parameters.Add(exists);
        command.Parameters.Add(length);
        command.Parameters.Add(blockSize);
        active.SetCommand(command);
        await command.ExecuteNonQueryAsync(cancellationToken);
        var fileExists = exists.Value switch
        {
            bool value => value,
            OracleBoolean value => !value.IsNull && value.Value,
            _ => false,
        };
        var bytes = fileExists
            && length.Value is not DBNull
            && long.TryParse(Convert.ToString(length.Value, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedLength)
                ? parsedLength
                : 0;
        return (fileExists, bytes);
    }

    internal static string RequiredDataPumpIdentifier(string? value, string label)
    {
        var result = value?.Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(result) || !DataPumpIdentifierRegex().IsMatch(result))
        {
            throw new SidecarException("oracle-datapump-identifier-invalid", $"Oracle Data Pump requires one unquoted {label} using letters, numbers, _, $, or #.");
        }
        return result;
    }

    internal static string RequiredDataPumpFileName(string? value)
    {
        var result = value?.Trim();
        if (string.IsNullOrWhiteSpace(result) || result.Length > 200 || !DataPumpFileNameRegex().IsMatch(result) || !result.EndsWith(".dmp", StringComparison.OrdinalIgnoreCase))
        {
            throw new SidecarException("oracle-datapump-file-invalid", "Oracle Data Pump requires a .dmp file name without a directory path.");
        }
        return result;
    }

    private static string DataPumpSqlLiteral(string value) => $"'{value.Replace("'", "''")}'";

    [GeneratedRegex("^[A-Z][A-Z0-9_$#]{0,127}$", RegexOptions.CultureInvariant)]
    private static partial Regex DataPumpIdentifierRegex();

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$", RegexOptions.CultureInvariant)]
    private static partial Regex DataPumpFileNameRegex();
}
