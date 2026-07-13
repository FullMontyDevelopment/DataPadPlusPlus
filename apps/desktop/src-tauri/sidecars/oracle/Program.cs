using System.Collections.Concurrent;
using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Oracle.ManagedDataAccess.Client;
using Oracle.ManagedDataAccess.Types;

namespace DataPadPlusPlus.OracleSidecar;

internal static partial class Program
{
    private const int ProtocolVersion = 1;
    private const int MaxLobCharacters = 1_048_576;
    private const int MaxBinaryBytes = 1_048_576;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
    private static readonly SemaphoreSlim OutputLock = new(1, 1);
    private static readonly ConcurrentDictionary<string, ActiveRequest> ActiveRequests = new();
    private static readonly ConcurrentDictionary<string, Task> RequestTasks = new();

    public static async Task<int> Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        string? line;
        while ((line = await Console.In.ReadLineAsync()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            OracleRequest? request;
            try
            {
                request = JsonSerializer.Deserialize<OracleRequest>(line, JsonOptions);
            }
            catch
            {
                await WriteResponseAsync(OracleResponse.Failure(
                    "unknown",
                    "oracle-sidecar-request-invalid",
                    "Oracle runtime received an invalid JSON request."));
                continue;
            }

            if (request is null || string.IsNullOrWhiteSpace(request.RequestId))
            {
                await WriteResponseAsync(OracleResponse.Failure(
                    request?.RequestId ?? "unknown",
                    "oracle-sidecar-request-invalid",
                    "Oracle runtime request ID is required."));
                continue;
            }

            if (request.ProtocolVersion != ProtocolVersion)
            {
                await WriteResponseAsync(OracleResponse.Failure(
                    request.RequestId,
                    "oracle-sidecar-protocol-unsupported",
                    $"Oracle runtime protocol {request.ProtocolVersion} is not supported."));
                continue;
            }

            if (request.Operation.Equals("cancel", StringComparison.OrdinalIgnoreCase))
            {
                await HandleCancelAsync(request);
                continue;
            }

            var task = HandleRequestAsync(request);
            RequestTasks[request.RequestId] = task;
            _ = task.ContinueWith(
                completed =>
                {
                    _ = completed.Exception;
                    RequestTasks.TryRemove(request.RequestId, out _);
                },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
        }

        var remaining = RequestTasks.Values.ToArray();
        if (remaining.Length > 0)
        {
            await Task.WhenAll(remaining);
        }

        return 0;
    }

    private static async Task HandleRequestAsync(OracleRequest request)
    {
        using var cancellation = new CancellationTokenSource();
        if (request.TimeoutMs is > 0)
        {
            cancellation.CancelAfter(TimeSpan.FromMilliseconds(Math.Clamp(request.TimeoutMs.Value, 1_000, 300_000)));
        }

        var active = new ActiveRequest(cancellation);
        if (!ActiveRequests.TryAdd(request.RequestId, active))
        {
            await WriteResponseAsync(OracleResponse.Failure(
                request.RequestId,
                "oracle-sidecar-request-duplicate",
                "An Oracle runtime request with this ID is already active."));
            return;
        }

        try
        {
            var result = request.Operation.ToLowerInvariant() switch
            {
                "test" => await TestConnectionAsync(request, active, cancellation.Token),
                "execute" => await ExecuteAsync(request, active, cancellation.Token),
                _ => throw new SidecarException(
                    "oracle-sidecar-operation-unsupported",
                    $"Oracle runtime operation '{request.Operation}' is not supported."),
            };
            await WriteResponseAsync(OracleResponse.Success(request.RequestId, result));
        }
        catch (OperationCanceledException)
        {
            await WriteResponseAsync(OracleResponse.Failure(
                request.RequestId,
                "oracle-query-cancelled",
                "Oracle execution was cancelled or exceeded its timeout."));
        }
        catch (SidecarException error)
        {
            await WriteResponseAsync(OracleResponse.Failure(request.RequestId, error.Code, error.Message));
        }
        catch (OracleException error)
        {
            await WriteResponseAsync(OracleResponse.Failure(
                request.RequestId,
                error.Number == 0 ? "oracle-runtime-error" : $"ORA-{Math.Abs(error.Number):00000}",
                SanitizeOracleMessage(error.Message)));
        }
        catch (Exception error)
        {
            await WriteResponseAsync(OracleResponse.Failure(
                request.RequestId,
                "oracle-runtime-error",
                SanitizeOracleMessage(error.Message)));
        }
        finally
        {
            ActiveRequests.TryRemove(request.RequestId, out _);
        }
    }

    private static async Task HandleCancelAsync(OracleRequest request)
    {
        var target = request.TargetRequestId?.Trim();
        ActiveRequest? active = null;
        var cancelled = target is not null && ActiveRequests.TryGetValue(target, out active);
        if (cancelled && active is not null)
        {
            active.Cancel();
        }

        await WriteResponseAsync(OracleResponse.Success(request.RequestId, new
        {
            cancelled,
            targetRequestId = target,
        }));
    }

    private static async Task<object> TestConnectionAsync(
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        var input = RequiredConnection(request);
        var started = Stopwatch.StartNew();
        await using var connection = BuildConnection(input);
        await connection.OpenAsync(cancellationToken);
        ApplySessionIdentity(connection, input);

        const string probe = "select user, sys_context('USERENV', 'DB_NAME'), sys_context('USERENV', 'SERVICE_NAME') from dual";
        await using var command = connection.CreateCommand();
        command.CommandText = probe;
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        active.SetCommand(command);
        await using var reader = await command.ExecuteReaderAsync(CommandBehavior.SingleRow, cancellationToken);
        await reader.ReadAsync(cancellationToken);

        return new
        {
            authenticatedSchema = ValueAsString(reader.GetValue(0)),
            databaseName = ValueAsString(reader.GetValue(1)),
            serviceName = ValueAsString(reader.GetValue(2)),
            serverVersion = connection.ServerVersion,
            tls = input.UseTls || input.ConnectMode is "tcps" or "cloud-wallet",
            durationMs = started.ElapsedMilliseconds,
        };
    }

    private static async Task<object> ExecuteAsync(
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        var input = RequiredConnection(request);
        var script = request.Statement?.Trim();
        if (string.IsNullOrWhiteSpace(script))
        {
            throw new SidecarException("oracle-query-missing", "No Oracle SQL or PL/SQL statement was provided.");
        }

        var statements = OracleScriptSplitter.Split(script);
        if (statements.Count == 0)
        {
            throw new SidecarException("oracle-query-missing", "No executable Oracle statement was found.");
        }

        foreach (var statement in statements)
        {
            RejectSqlPlusCommand(statement);
            if (request.ReadOnly && !OracleStatementClassifier.IsReadOnly(statement))
            {
                throw new SidecarException(
                    "oracle-read-only-blocked",
                    "This Oracle connection is read-only, so the statement was blocked before execution.");
            }
        }

        var rowLimit = Math.Clamp(request.RowLimit ?? 500, 1, 10_000);
        var sections = new List<OracleResultSection>();
        var dbmsOutput = new List<string>();
        var scriptStarted = Stopwatch.StartNew();
        var containsMutation = statements.Any(statement => !OracleStatementClassifier.IsReadOnly(statement));

        await using var connection = BuildConnection(input);
        await connection.OpenAsync(cancellationToken);
        ApplySessionIdentity(connection, input);

        try
        {
            var dbmsOutputEnabled = request.CaptureDbmsOutput &&
                await TryEnableDbmsOutputAsync(connection, request, active, cancellationToken);
            var executableStatements = BuildExecutionStatements(statements, request.Mode);
            foreach (var statement in executableStatements)
            {
                sections.AddRange(await ExecuteStatementAsync(
                    connection,
                    statement,
                    rowLimit,
                    request,
                    active,
                    cancellationToken));
            }

            if (dbmsOutputEnabled)
            {
                dbmsOutput.AddRange(await TryReadDbmsOutputAsync(
                    connection,
                    request,
                    active,
                    cancellationToken));
            }
            if (containsMutation)
            {
                await ExecuteTransactionControlAsync(connection, "commit", request, active, cancellationToken);
            }
        }
        catch
        {
            try
            {
                await ExecuteTransactionControlAsync(connection, "rollback", request, active, CancellationToken.None);
            }
            catch
            {
                // Preserve the original Oracle error.
            }
            throw;
        }

        return new
        {
            sections,
            dbmsOutput,
            committed = containsMutation,
            durationMs = scriptStarted.ElapsedMilliseconds,
        };
    }

    private static IReadOnlyList<string> BuildExecutionStatements(IReadOnlyList<string> statements, string? mode)
    {
        if (!string.Equals(mode, "explain", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(mode, "plan", StringComparison.OrdinalIgnoreCase))
        {
            return statements;
        }

        if (statements.Count != 1 || !OracleStatementClassifier.IsReadOnly(statements[0]))
        {
            throw new SidecarException(
                "oracle-explain-statement-invalid",
                "Oracle Explain requires one read-only SQL statement.");
        }

        return new[]
        {
            $"explain plan for {statements[0]}",
            "select plan_table_output from table(dbms_xplan.display(format => 'TYPICAL'))",
        };
    }

    private static async Task<IReadOnlyList<OracleResultSection>> ExecuteStatementAsync(
        OracleConnection connection,
        string statement,
        int rowLimit,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        var started = Stopwatch.StartNew();
        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.CommandText = statement;
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        if (request.FetchSize is > 0)
        {
            command.FetchSize = Math.Clamp(request.FetchSize.Value, 1, 16 * 1024 * 1024);
        }
        active.SetCommand(command);

        var result = new List<OracleResultSection>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        do
        {
            if (reader.FieldCount == 0)
            {
                continue;
            }

            var columns = Enumerable.Range(0, reader.FieldCount)
                .Select(index => new OracleColumn(reader.GetName(index), reader.GetDataTypeName(index)))
                .ToArray();
            var rows = new List<IReadOnlyList<string?>>();
            var truncated = false;
            while (await reader.ReadAsync(cancellationToken))
            {
                if (rows.Count >= rowLimit)
                {
                    truncated = true;
                    break;
                }

                var row = new string?[reader.FieldCount];
                for (var index = 0; index < reader.FieldCount; index++)
                {
                    row[index] = await ReadCellAsync(reader, index, cancellationToken);
                }
                rows.Add(row);
            }

            result.Add(new OracleResultSection(
                columns,
                rows,
                reader.RecordsAffected < 0 ? null : reader.RecordsAffected,
                OracleStatementClassifier.Kind(statement),
                started.ElapsedMilliseconds,
                truncated));
        }
        while (await reader.NextResultAsync(cancellationToken));

        if (result.Count == 0)
        {
            result.Add(new OracleResultSection(
                Array.Empty<OracleColumn>(),
                Array.Empty<IReadOnlyList<string?>>(),
                reader.RecordsAffected < 0 ? 0 : reader.RecordsAffected,
                OracleStatementClassifier.Kind(statement),
                started.ElapsedMilliseconds,
                false));
        }

        return result;
    }

    private static async Task<string?> ReadCellAsync(
        OracleDataReader reader,
        int index,
        CancellationToken cancellationToken)
    {
        if (await reader.IsDBNullAsync(index, cancellationToken))
        {
            return null;
        }

        var value = reader.GetValue(index);
        return value switch
        {
            byte[] bytes => BinaryValue(bytes),
            OracleBlob blob => BinaryValue(ReadBlob(blob)),
            OracleClob clob => ReadClob(clob),
            DateTime dateTime => dateTime.ToString("O", CultureInfo.InvariantCulture),
            DateTimeOffset offset => offset.ToString("O", CultureInfo.InvariantCulture),
            TimeSpan span => span.ToString("c", CultureInfo.InvariantCulture),
            OracleDecimal number => number.ToString(),
            OracleDate date => date.Value.ToString("O", CultureInfo.InvariantCulture),
            OracleString text => text.Value,
            OracleTimeStamp timestamp => timestamp.Value.ToString("O", CultureInfo.InvariantCulture),
            OracleTimeStampLTZ timestamp => timestamp.Value.ToString("O", CultureInfo.InvariantCulture),
            OracleTimeStampTZ timestamp => timestamp.ToString(),
            OracleIntervalDS interval => interval.ToString(),
            OracleIntervalYM interval => interval.ToString(),
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString(),
        };
    }

    private static byte[] ReadBlob(OracleBlob blob)
    {
        var length = (int)Math.Min(blob.Length, MaxBinaryBytes);
        var bytes = new byte[length];
        _ = blob.Read(bytes, 0, length);
        return bytes;
    }

    private static string ReadClob(OracleClob clob)
    {
        var length = (int)Math.Min(clob.Length, MaxLobCharacters);
        var buffer = new char[length];
        _ = clob.Read(buffer, 0, length);
        var value = new string(buffer);
        return clob.Length > length ? $"{value}\n[truncated at {length} characters]" : value;
    }

    private static string BinaryValue(byte[] bytes)
    {
        var length = Math.Min(bytes.Length, MaxBinaryBytes);
        var encoded = Convert.ToBase64String(bytes, 0, length);
        return bytes.Length > length
            ? $"base64:{encoded} [truncated; {bytes.Length} bytes total]"
            : $"base64:{encoded}";
    }

    private static async Task<bool> TryEnableDbmsOutputAsync(
        OracleConnection connection,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "begin dbms_output.enable(null); end;";
            command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
            active.SetCommand(command);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return true;
        }
        catch (OracleException)
        {
            // DBMS_OUTPUT is optional and may be revoked in hardened databases.
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private static async Task<IReadOnlyList<string>> TryReadDbmsOutputAsync(
        OracleConnection connection,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        try
        {
            const int lineLimit = 1_000;
            await using var command = connection.CreateCommand();
            command.BindByName = true;
            command.CommandText = "begin dbms_output.get_lines(:lines, :line_count); end;";
            command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
            var lines = new OracleParameter("lines", OracleDbType.Varchar2)
            {
                Direction = ParameterDirection.Output,
                CollectionType = OracleCollectionType.PLSQLAssociativeArray,
                Size = lineLimit,
                ArrayBindSize = Enumerable.Repeat(32_767, lineLimit).ToArray(),
            };
            var lineCount = new OracleParameter("line_count", OracleDbType.Int32)
            {
                Direction = ParameterDirection.InputOutput,
                Value = lineLimit,
            };
            command.Parameters.Add(lines);
            command.Parameters.Add(lineCount);
            active.SetCommand(command);
            await command.ExecuteNonQueryAsync(cancellationToken);

            return lines.Value switch
            {
                string[] values => values.Where(value => !string.IsNullOrEmpty(value)).ToArray(),
                OracleString[] values => values
                    .Where(value => !value.IsNull && !string.IsNullOrEmpty(value.Value))
                    .Select(value => value.Value)
                    .ToArray(),
                _ => Array.Empty<string>(),
            };
        }
        catch (OracleException)
        {
            return Array.Empty<string>();
        }
        catch (InvalidOperationException)
        {
            return Array.Empty<string>();
        }
    }

    private static async Task ExecuteTransactionControlAsync(
        OracleConnection connection,
        string statement,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = statement;
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        active.SetCommand(command);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static OracleConnection BuildConnection(OracleConnectionInput input)
    {
        ValidateConnectionInput(input);
        var builder = string.IsNullOrWhiteSpace(input.ConnectionString)
            ? new OracleConnectionStringBuilder()
            : new OracleConnectionStringBuilder(input.ConnectionString);

        builder.DataSource = DataSource(input);
        if (!string.IsNullOrWhiteSpace(input.Username))
        {
            builder.UserID = string.IsNullOrWhiteSpace(input.ProxyUser)
                ? input.Username
                : $"{input.ProxyUser}[{input.Username}]";
        }
        if (input.Password is not null)
        {
            builder.Password = input.Password;
        }
        builder.Pooling = true;
        if (input.PoolMin is >= 0)
        {
            builder.MinPoolSize = input.PoolMin.Value;
        }
        if (input.PoolMax is > 0)
        {
            builder.MaxPoolSize = input.PoolMax.Value;
        }
        if (input.StatementCacheSize is >= 0)
        {
            builder.StatementCacheSize = input.StatementCacheSize.Value;
        }
        if (input.ConnectionTimeoutMs is > 0)
        {
            builder.ConnectionTimeout = Math.Max(1, input.ConnectionTimeoutMs.Value / 1_000);
        }
        if (input.ValidateConnection is not null)
        {
            builder.ValidateConnection = input.ValidateConnection.Value;
        }
        if (input.HighAvailabilityEvents is not null)
        {
            builder.HAEvents = input.HighAvailabilityEvents.Value;
        }
        if (input.LoadBalancing is not null)
        {
            builder.LoadBalancing = input.LoadBalancing.Value;
        }
        if (!string.IsNullOrWhiteSpace(input.ConnectionRole) && input.ConnectionRole != "default")
        {
            builder.DBAPrivilege = input.ConnectionRole.ToUpperInvariant();
        }
        if (!string.IsNullOrWhiteSpace(input.Edition))
        {
            builder["Edition"] = input.Edition;
        }
        if (!string.IsNullOrWhiteSpace(input.TnsAdminPath))
        {
            builder["Tns_Admin"] = input.TnsAdminPath;
        }
        if (!string.IsNullOrWhiteSpace(input.WalletPath))
        {
            builder["Wallet_Location"] = input.WalletPath;
        }
        if (input.WalletPassword is not null)
        {
            builder["Wallet_Password"] = input.WalletPassword;
        }

        return new OracleConnection(builder.ConnectionString);
    }

    internal static string DataSource(OracleConnectionInput input)
    {
        if (!string.IsNullOrWhiteSpace(input.ConnectionString))
        {
            var existing = new OracleConnectionStringBuilder(input.ConnectionString).DataSource;
            if (!string.IsNullOrWhiteSpace(existing))
            {
                return existing;
            }
        }
        if (!string.IsNullOrWhiteSpace(input.EasyConnectString))
        {
            return input.EasyConnectString;
        }
        if (!string.IsNullOrWhiteSpace(input.TnsAlias))
        {
            return input.TnsAlias;
        }

        var protocol = input.UseTls || input.ConnectMode is "tcps" or "cloud-wallet" ? "TCPS" : "TCP";
        var host = string.IsNullOrWhiteSpace(input.Host) ? "127.0.0.1" : input.Host;
        var port = input.Port is > 0 ? input.Port.Value : 1521;
        var connectData = input.ConnectMode == "sid"
            ? $"(SID={RequiredValue(input.Sid, "Oracle SID")})"
            : $"(SERVICE_NAME={RequiredValue(input.ServiceName ?? input.Database, "Oracle service name")})";
        return $"(DESCRIPTION=(ADDRESS=(PROTOCOL={protocol})(HOST={host})(PORT={port}))(CONNECT_DATA={connectData}))";
    }

    private static void ApplySessionIdentity(OracleConnection connection, OracleConnectionInput input)
    {
        if (!string.IsNullOrWhiteSpace(input.ClientIdentifier))
        {
            connection.ClientId = input.ClientIdentifier;
        }
        if (!string.IsNullOrWhiteSpace(input.ApplicationName))
        {
            connection.ModuleName = input.ApplicationName;
        }
    }

    private static void ValidateConnectionInput(OracleConnectionInput input)
    {
        if (string.IsNullOrWhiteSpace(input.ConnectionString) && string.IsNullOrWhiteSpace(input.Username))
        {
            throw new SidecarException("oracle-username-missing", "Oracle username is required.");
        }
        if (!string.IsNullOrWhiteSpace(input.CaCertificatePath) ||
            !string.IsNullOrWhiteSpace(input.ClientCertificatePath) ||
            !string.IsNullOrWhiteSpace(input.ClientKeyPath))
        {
            throw new SidecarException(
                "oracle-pem-unsupported",
                "The built-in Oracle runtime uses TCPS wallets. Configure a wallet path instead of individual PEM certificate fields.");
        }
    }

    private static OracleConnectionInput RequiredConnection(OracleRequest request) =>
        request.Connection ?? throw new SidecarException(
            "oracle-connection-missing",
            "Oracle connection details are required.");

    private static string RequiredValue(string? value, string label) =>
        !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new SidecarException("oracle-connection-invalid", $"{label} is required.");

    private static int CommandTimeoutSeconds(int? timeoutMs) =>
        Math.Max(1, Math.Clamp(timeoutMs ?? 30_000, 1_000, 300_000) / 1_000);

    private static void RejectSqlPlusCommand(string statement)
    {
        var trimmed = statement.TrimStart();
        if (SqlPlusCommandRegex().IsMatch(trimmed))
        {
            throw new SidecarException(
                "oracle-sqlplus-command-unsupported",
                "SQLPlus client commands are not SQL or PL/SQL. Use the SQLPlus fallback runtime for this script.");
        }
    }

    internal static string SanitizeOracleMessage(string message)
    {
        var firstLine = message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        firstLine = ConnectionSecretRegex().Replace(firstLine, "$1=[redacted]");
        return firstLine.Length <= 2_000 ? firstLine : firstLine[..2_000];
    }

    private static string? ValueAsString(object value) => value is DBNull ? null : value.ToString();

    private static async Task WriteResponseAsync(OracleResponse response)
    {
        var json = JsonSerializer.Serialize(response, JsonOptions);
        await OutputLock.WaitAsync();
        try
        {
            await Console.Out.WriteLineAsync(json);
            await Console.Out.FlushAsync();
        }
        finally
        {
            OutputLock.Release();
        }
    }

    [GeneratedRegex(@"^(?:@{1,2}|set\s|spool\s|prompt(?:\s|$)|define\s|undefine\s|column\s|whenever\s|connect\s|host\s|exit(?:\s|$))", RegexOptions.IgnoreCase)]
    private static partial Regex SqlPlusCommandRegex();

    [GeneratedRegex(@"(?i)\b(password|pwd|wallet_password|proxy password)\b\s*=\s*(?:""[^""]*""|'[^']*'|[^\s;,\r\n]+)")]
    private static partial Regex ConnectionSecretRegex();
}

internal sealed class ActiveRequest(CancellationTokenSource cancellation)
{
    private OracleCommand? _command;

    public void SetCommand(OracleCommand command) => Interlocked.Exchange(ref _command, command);

    public void Cancel()
    {
        cancellation.Cancel();
        try
        {
            Volatile.Read(ref _command)?.Cancel();
        }
        catch
        {
            // Cancellation is best effort; the request task reports the final state.
        }
    }
}

internal sealed record OracleRequest(
    int ProtocolVersion,
    string RequestId,
    string Operation,
    OracleConnectionInput? Connection,
    string? Statement,
    string? Mode,
    int? RowLimit,
    int? TimeoutMs,
    int? FetchSize,
    bool ReadOnly,
    bool CaptureDbmsOutput,
    string? TargetRequestId);

internal sealed record OracleConnectionInput(
    string? Host,
    int? Port,
    string? Database,
    string? Username,
    string? Password,
    string? ConnectionString,
    string? ConnectMode,
    string? ServiceName,
    string? Sid,
    string? TnsAlias,
    string? EasyConnectString,
    string? ConnectionRole,
    string? ProxyUser,
    string? ClientIdentifier,
    string? ApplicationName,
    string? Edition,
    int? StatementCacheSize,
    int? ConnectionTimeoutMs,
    int? PoolMin,
    int? PoolMax,
    bool? ValidateConnection,
    bool? HighAvailabilityEvents,
    bool? LoadBalancing,
    bool UseTls,
    string? WalletPath,
    string? WalletPassword,
    string? TnsAdminPath,
    string? CaCertificatePath,
    string? ClientCertificatePath,
    string? ClientKeyPath);

internal sealed record OracleResponse(
    int ProtocolVersion,
    string RequestId,
    bool Ok,
    object? Result,
    string? Code,
    string? Message)
{
    public static OracleResponse Success(string requestId, object result) =>
        new(ProgramProtocol.Version, requestId, true, result, null, null);

    public static OracleResponse Failure(string requestId, string code, string message) =>
        new(ProgramProtocol.Version, requestId, false, null, code, message);
}

internal static class ProgramProtocol
{
    public const int Version = 1;
}

internal sealed record OracleColumn(string Name, string DataType);

internal sealed record OracleResultSection(
    IReadOnlyList<OracleColumn> Columns,
    IReadOnlyList<IReadOnlyList<string?>> Rows,
    int? AffectedRows,
    string StatementKind,
    long DurationMs,
    bool Truncated);

internal sealed class SidecarException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

internal static partial class OracleStatementClassifier
{
    private static readonly HashSet<string> ReadOnlyFirstTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        "select", "with", "explain", "describe", "desc",
    };

    private static readonly HashSet<string> MutationTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        "insert", "update", "delete", "merge", "create", "alter", "drop", "truncate",
        "grant", "revoke", "comment", "rename", "flashback", "purge", "audit", "noaudit",
        "call", "exec", "execute", "begin", "declare", "commit", "rollback", "savepoint",
        "lock", "set",
    };

    public static bool IsReadOnly(string statement)
    {
        var tokens = Tokens(statement);
        if (tokens.Count == 0 || !ReadOnlyFirstTokens.Contains(tokens[0]))
        {
            return false;
        }
        if (tokens[0].Equals("with", StringComparison.OrdinalIgnoreCase) && tokens.Any(MutationTokens.Contains))
        {
            return false;
        }
        return !ContainsSequence(tokens, "for", "update") &&
               !ContainsSequence(tokens, "execute", "immediate");
    }

    public static string Kind(string statement)
    {
        var tokens = Tokens(statement);
        return tokens.Count == 0 ? "unknown" : tokens[0].ToLowerInvariant();
    }

    private static List<string> Tokens(string statement)
    {
        var scrubbed = LiteralsAndCommentsRegex().Replace(statement, " ");
        return TokenRegex().Matches(scrubbed).Select(match => match.Value).ToList();
    }

    private static bool ContainsSequence(IReadOnlyList<string> tokens, string first, string second)
    {
        for (var index = 0; index + 1 < tokens.Count; index++)
        {
            if (tokens[index].Equals(first, StringComparison.OrdinalIgnoreCase) &&
                tokens[index + 1].Equals(second, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    [GeneratedRegex("--[^\\r\\n]*|/\\*[\\s\\S]*?\\*/|'(?:''|[^'])*'|\\\"(?:\\\"\\\"|[^\\\"])*\\\"")]
    private static partial Regex LiteralsAndCommentsRegex();

    [GeneratedRegex(@"[A-Za-z_][A-Za-z0-9_$#]*")]
    private static partial Regex TokenRegex();
}

internal static class OracleScriptSplitter
{
    public static IReadOnlyList<string> Split(string script)
    {
        var statements = new List<string>();
        var buffer = new StringBuilder();
        var inSingleQuote = false;
        var inDoubleQuote = false;
        var inLineComment = false;
        var inBlockComment = false;
        var plsql = LooksLikePlSql(script);

        for (var index = 0; index < script.Length; index++)
        {
            var current = script[index];
            var next = index + 1 < script.Length ? script[index + 1] : '\0';

            if (inLineComment)
            {
                buffer.Append(current);
                if (current == '\n')
                {
                    inLineComment = false;
                }
                continue;
            }
            if (inBlockComment)
            {
                buffer.Append(current);
                if (current == '*' && next == '/')
                {
                    buffer.Append(next);
                    index++;
                    inBlockComment = false;
                }
                continue;
            }
            if (!inSingleQuote && !inDoubleQuote && current == '-' && next == '-')
            {
                buffer.Append(current).Append(next);
                index++;
                inLineComment = true;
                continue;
            }
            if (!inSingleQuote && !inDoubleQuote && current == '/' && next == '*')
            {
                buffer.Append(current).Append(next);
                index++;
                inBlockComment = true;
                continue;
            }
            if (!inSingleQuote && !inDoubleQuote && plsql && current == '/' && IsSlashDelimiter(script, index))
            {
                AddStatement(statements, buffer);
                plsql = LooksLikePlSql(script[(index + 1)..]);
                continue;
            }
            if (!inDoubleQuote && current == '\'')
            {
                buffer.Append(current);
                if (inSingleQuote && next == '\'')
                {
                    buffer.Append(next);
                    index++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                continue;
            }
            if (!inSingleQuote && current == '"')
            {
                buffer.Append(current);
                if (inDoubleQuote && next == '"')
                {
                    buffer.Append(next);
                    index++;
                    continue;
                }
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote && current == ';' && !plsql)
            {
                AddStatement(statements, buffer);
                plsql = LooksLikePlSql(script[(index + 1)..]);
                continue;
            }

            buffer.Append(current);
        }

        var final = buffer.ToString().Trim();
        if (plsql)
        {
            final = Regex.Replace(final, @"(?m)^\s*/\s*$", string.Empty).Trim();
        }
        if (final.EndsWith(';') && !plsql)
        {
            final = final[..^1].TrimEnd();
        }
        if (final.Length > 0)
        {
            statements.Add(final);
        }
        return statements;
    }

    private static void AddStatement(ICollection<string> statements, StringBuilder buffer)
    {
        var statement = buffer.ToString().Trim();
        if (statement.Length > 0)
        {
            statements.Add(statement);
        }
        buffer.Clear();
    }

    private static bool IsSlashDelimiter(string script, int index)
    {
        var lineStart = script.LastIndexOf('\n', Math.Max(0, index - 1));
        var lineEnd = script.IndexOf('\n', index + 1);
        lineStart = lineStart < 0 ? 0 : lineStart + 1;
        lineEnd = lineEnd < 0 ? script.Length : lineEnd;
        return script[lineStart..index].Trim().Length == 0 &&
               script[(index + 1)..lineEnd].Trim().Length == 0;
    }

    private static bool LooksLikePlSql(string text)
    {
        var normalized = Regex.Replace(text.TrimStart(), @"^(?:(?:--[^\r\n]*\r?\n)|(?:/\*[\s\S]*?\*/\s*))*", string.Empty, RegexOptions.IgnoreCase);
        return Regex.IsMatch(normalized, @"^(?:declare\b|begin\b|create\s+(?:or\s+replace\s+)?(?:procedure|function|package|trigger|type)\b)", RegexOptions.IgnoreCase);
    }
}
