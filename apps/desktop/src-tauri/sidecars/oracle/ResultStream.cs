using System.Data;
using System.Text.Json;
using Oracle.ManagedDataAccess.Client;

namespace DataPadPlusPlus.OracleSidecar;

internal static partial class Program
{
    internal static string ExportStatement(OracleRequest request)
    {
        var statements = OracleScriptSplitter.Split(request.Statement ?? "");
        if (!request.ReadOnly || !request.Operation.Equals("execute", StringComparison.OrdinalIgnoreCase)
            || request.Mode is not (null or "full" or "selection") || statements.Count != 1
            || !OracleStatementClassifier.IsReadOnly(statements[0]))
        {
            throw new SidecarException("result-export-read-only", "Full Oracle export requires one read-only SELECT query.");
        }
        return statements[0];
    }

    internal static void ValidateExportColumns(IEnumerable<string> columns)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var name in columns)
        {
            if (!names.Add(name))
            {
                throw new SidecarException("result-export-duplicate-column", "Give each exported Oracle column a unique alias.");
            }
        }
    }

    private static async Task<int> StreamResultAsync(OracleRequest request)
    {
        using var cancellation = new CancellationTokenSource(
            TimeSpan.FromMilliseconds(Math.Clamp(request.TimeoutMs ?? 30_000, 1_000, 300_000)));
        var active = new ActiveRequest(cancellation);
        try
        {
            var statement = ExportStatement(request);
            var input = RequiredConnection(request);
            await using var connection = BuildConnection(input);
            // Do not let command-level autocommit end the read-only transaction.
            connection.AutoCommit = false;
            await connection.OpenAsync(cancellation.Token);
            ApplySessionIdentity(connection, input);
            await ApplyCurrentSchemaAsync(connection, request, active, cancellation.Token);
            await using (var guard = connection.CreateCommand())
            {
                guard.CommandText = "set transaction read only";
                guard.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
                active.SetCommand(guard);
                await guard.ExecuteNonQueryAsync(cancellation.Token);
            }

            await using var command = connection.CreateCommand();
            command.CommandText = statement;
            command.BindByName = true;
            command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
            command.FetchSize = Math.Clamp(request.FetchSize ?? 131_072, 1, 16 * 1024 * 1024);
            active.SetCommand(command);
            await using var reader = await command.ExecuteReaderAsync(CommandBehavior.SequentialAccess, cancellation.Token);
            var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToArray();
            ValidateExportColumns(columns);
            if (columns.Length == 0)
                throw new SidecarException("result-export-read-only", "The Oracle query did not return a tabular result.");
            long count = 0;
            while (await reader.ReadAsync(cancellation.Token))
            {
                var row = new Dictionary<string, string?>(StringComparer.Ordinal);
                for (var index = 0; index < columns.Length; index++)
                {
                    // Use the complete-value transfer codec, not the bounded UI preview codec.
                    row.Add(columns[index], await ReadTransferCellAsync(reader, index, cancellation.Token));
                }
                await WriteExportFrameAsync(new { kind = "row", value = row }, cancellation.Token);
                count++;
            }
            if (await reader.NextResultAsync(cancellation.Token))
                throw new SidecarException("result-export-unsupported", "Export one Oracle result set at a time.");
            await WriteExportFrameAsync(new { kind = "complete", count }, cancellation.Token);
            return 0;
        }
        catch (OperationCanceledException)
        {
            await WriteExportFailureAsync("oracle-query-cancelled");
        }
        catch (SidecarException error)
        {
            await WriteExportFailureAsync(error.Code);
        }
        catch
        {
            // Provider errors may contain query text, bind values, or a descriptor.
            await WriteExportFailureAsync("oracle-stream-failed");
        }
        return 1;
    }

    private static async Task WriteExportFrameAsync(object frame, CancellationToken cancellationToken)
    {
        var line = JsonSerializer.Serialize(frame, JsonOptions);
        // Bound one record, independently of dataset size. Never report a truncated row as success.
        if (System.Text.Encoding.UTF8.GetByteCount(line) >= 128 * 1024 * 1024 - 1)
            throw new SidecarException("result-export-row-too-large", "An Oracle row exceeds the export transport limit.");
        await Console.Out.WriteLineAsync(line.AsMemory(), cancellationToken);
        await Console.Out.FlushAsync(cancellationToken);
    }

    private static async Task WriteExportFailureAsync(string code)
    {
        try { await WriteExportFrameAsync(new { kind = "error", code }, CancellationToken.None); }
        catch (IOException) { /* The parent canceled by closing its private pipe. */ }
    }
}
