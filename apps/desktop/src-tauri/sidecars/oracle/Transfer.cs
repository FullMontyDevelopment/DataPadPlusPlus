using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.VisualBasic.FileIO;
using Oracle.ManagedDataAccess.Client;
using Oracle.ManagedDataAccess.Types;

namespace DataPadPlusPlus.OracleSidecar;

internal static partial class Program
{
    private const int TransferBatchSize = 500;

    private static async Task<object> ExportCsvAsync(
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        var (schema, table, path) = RequiredCsvTransfer(request);
        var input = RequiredConnection(request);
        var temporaryPath = $"{path}.partial-{Guid.NewGuid():N}";
        if (File.Exists(path))
        {
            throw new SidecarException(
                "oracle-export-target-exists",
                "The selected Oracle export file already exists. Choose a new destination so DataPad++ cannot overwrite an existing artifact.");
        }

        var started = Stopwatch.StartNew();
        long rowCount = 0;
        try
        {
            await using var connection = BuildConnection(input);
            await connection.OpenAsync(cancellationToken);
            ApplySessionIdentity(connection, input);
            await ApplyCurrentSchemaAsync(connection, request, active, cancellationToken);
            var columns = await ReadTransferColumnsAsync(connection, schema, table, request, active, cancellationToken);
            if (columns.Count == 0)
            {
                throw new SidecarException("oracle-transfer-columns-missing", "The selected Oracle table has no importable columns.");
            }

            await using var command = connection.CreateCommand();
            command.CommandText = $"select {string.Join(", ", columns.Select(column => QuoteIdentifier(column.Name)))} from {QualifiedName(schema, table)}";
            command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
            if (request.FetchSize is > 0)
            {
                command.FetchSize = Math.Clamp(request.FetchSize.Value, 1, 16 * 1024 * 1024);
            }
            active.SetCommand(command);

            await using var output = new StreamWriter(
                new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, true),
                new UTF8Encoding(false));
            await WriteCsvRowAsync(output, columns.Select(column => column.Name), cancellationToken);
            await using var reader = await command.ExecuteReaderAsync(CommandBehavior.SequentialAccess, cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var values = new string?[reader.FieldCount];
                for (var index = 0; index < reader.FieldCount; index++)
                {
                    values[index] = await ReadTransferCellAsync(reader, index, cancellationToken);
                }
                await WriteCsvRowAsync(output, values, cancellationToken);
                rowCount++;
            }
            await output.FlushAsync(cancellationToken);
            await output.DisposeAsync();
            File.Move(temporaryPath, path, false);
            return new
            {
                workflow = "oracle.table.export",
                format = "csv",
                schema,
                table,
                exportedCount = rowCount,
                bytesWritten = new FileInfo(path).Length,
                durationMs = started.ElapsedMilliseconds,
            };
        }
        catch (SidecarException)
        {
            TryDeleteTransferFile(temporaryPath);
            throw;
        }
        catch (IOException)
        {
            TryDeleteTransferFile(temporaryPath);
            throw new SidecarException("oracle-export-file-failed", "Oracle CSV export could not write the selected local file.");
        }
        catch
        {
            TryDeleteTransferFile(temporaryPath);
            throw;
        }
    }

    private static async Task<object> ImportCsvAsync(
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(request.ConflictPolicy, "fail", StringComparison.OrdinalIgnoreCase))
        {
            throw new SidecarException("oracle-import-conflict-policy-invalid", "Oracle CSV import requires the fail-safe conflict policy.");
        }
        if (request.ReadOnly)
        {
            throw new SidecarException("oracle-read-only-blocked", "This Oracle connection is read-only, so CSV import is unavailable.");
        }

        var (schema, table, path) = RequiredCsvTransfer(request);
        if (!File.Exists(path))
        {
            throw new SidecarException("oracle-import-file-missing", "The selected Oracle CSV import file no longer exists.");
        }
        var started = Stopwatch.StartNew();
        long importedCount = 0;
        var input = RequiredConnection(request);
        await using var connection = BuildConnection(input);
        await connection.OpenAsync(cancellationToken);
        ApplySessionIdentity(connection, input);
        await ApplyCurrentSchemaAsync(connection, request, active, cancellationToken);
        var columns = await ReadTransferColumnsAsync(connection, schema, table, request, active, cancellationToken);
        if (columns.Count == 0)
        {
            throw new SidecarException("oracle-transfer-columns-missing", "The selected Oracle table has no importable columns.");
        }
        await EnsureOracleTargetEmptyAsync(connection, schema, table, request, active, cancellationToken);

        using var parser = new TextFieldParser(path, Encoding.UTF8, true)
        {
            TextFieldType = FieldType.Delimited,
            HasFieldsEnclosedInQuotes = true,
            TrimWhiteSpace = false,
        };
        parser.SetDelimiters(",");
        string[]? header;
        try
        {
            header = parser.ReadFields();
        }
        catch (MalformedLineException)
        {
            throw new SidecarException("oracle-import-csv-invalid", "The Oracle CSV header is malformed.");
        }
        if (header is null || !header.SequenceEqual(columns.Select(column => column.Name), StringComparer.Ordinal))
        {
            throw new SidecarException(
                "oracle-import-schema-mismatch",
                "The Oracle CSV columns do not exactly match the selected table's insertable columns and order.");
        }

        var rows = new List<string?[]>(TransferBatchSize);
        try
        {
            while (!parser.EndOfData)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var fields = parser.ReadFields();
                if (fields is null)
                {
                    continue;
                }
                if (fields.Length != columns.Count)
                {
                    throw new SidecarException("oracle-import-row-invalid", $"Oracle CSV row {importedCount + rows.Count + 2} has {fields.Length} values; {columns.Count} were expected.");
                }
                rows.Add(fields);
                if (rows.Count >= TransferBatchSize)
                {
                    importedCount += await InsertOracleBatchAsync(connection, schema, table, columns, rows, request, active, cancellationToken);
                    rows.Clear();
                }
            }
            if (rows.Count > 0)
            {
                importedCount += await InsertOracleBatchAsync(connection, schema, table, columns, rows, request, active, cancellationToken);
            }
            await ExecuteTransactionControlAsync(connection, "commit", request, active, cancellationToken);
        }
        catch (MalformedLineException)
        {
            await ExecuteTransactionControlAsync(connection, "rollback", request, active, CancellationToken.None);
            throw new SidecarException("oracle-import-csv-invalid", "The Oracle CSV file contains a malformed quoted row.");
        }
        catch
        {
            await ExecuteTransactionControlAsync(connection, "rollback", request, active, CancellationToken.None);
            throw;
        }

        return new
        {
            workflow = "oracle.table.import",
            format = "csv",
            schema,
            table,
            importedCount,
            conflictPolicy = "fail",
            durationMs = started.ElapsedMilliseconds,
        };
    }

    private static async Task<IReadOnlyList<OracleTransferColumn>> ReadTransferColumnsAsync(
        OracleConnection connection,
        string schema,
        string table,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.CommandText = "select column_name, data_type from all_tab_cols where owner = :owner and table_name = :table_name and hidden_column = 'NO' and virtual_column = 'NO' and identity_column = 'NO' order by column_id";
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        command.Parameters.Add("owner", OracleDbType.Varchar2, schema, ParameterDirection.Input);
        command.Parameters.Add("table_name", OracleDbType.Varchar2, table, ParameterDirection.Input);
        active.SetCommand(command);
        var columns = new List<OracleTransferColumn>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            columns.Add(new OracleTransferColumn(reader.GetString(0), reader.GetString(1)));
        }
        if (columns.Count == 0)
        {
            await EnsureOracleTableExistsAsync(connection, schema, table, request, active, cancellationToken);
        }
        return columns;
    }

    private static async Task EnsureOracleTableExistsAsync(
        OracleConnection connection,
        string schema,
        string table,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.CommandText = "select count(*) from all_tables where owner = :owner and table_name = :table_name";
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        command.Parameters.Add("owner", OracleDbType.Varchar2, schema, ParameterDirection.Input);
        command.Parameters.Add("table_name", OracleDbType.Varchar2, table, ParameterDirection.Input);
        active.SetCommand(command);
        var count = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
        if (count == 0)
        {
            throw new SidecarException("oracle-transfer-target-missing", $"Oracle table {schema}.{table} does not exist or is not visible to the connected user.");
        }
    }

    private static async Task EnsureOracleTargetEmptyAsync(
        OracleConnection connection,
        string schema,
        string table,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"select count(*) from {QualifiedName(schema, table)}";
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        active.SetCommand(command);
        var count = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
        if (count != 0)
        {
            throw new SidecarException("oracle-import-target-not-empty", $"Oracle import target {schema}.{table} contains {count} row(s). Import requires an existing empty table and never overwrites or appends.");
        }
    }

    private static async Task<int> InsertOracleBatchAsync(
        OracleConnection connection,
        string schema,
        string table,
        IReadOnlyList<OracleTransferColumn> columns,
        IReadOnlyList<string?[]> rows,
        OracleRequest request,
        ActiveRequest active,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.BindByName = true;
        command.ArrayBindCount = rows.Count;
        command.CommandText = $"insert into {QualifiedName(schema, table)} ({string.Join(", ", columns.Select(column => QuoteIdentifier(column.Name)))}) values ({string.Join(", ", columns.Select((_, index) => $":p{index}"))})";
        command.CommandTimeout = CommandTimeoutSeconds(request.TimeoutMs);
        for (var columnIndex = 0; columnIndex < columns.Count; columnIndex++)
        {
            var column = columns[columnIndex];
            var parameter = new OracleParameter($"p{columnIndex}", OracleTypeFor(column.DataType), ParameterDirection.Input)
            {
                Value = rows.Select(row => ParseOracleCsvValue(row[columnIndex], column)).ToArray(),
            };
            command.Parameters.Add(parameter);
        }
        active.SetCommand(command);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static object ParseOracleCsvValue(string? value, OracleTransferColumn column)
    {
        if (string.IsNullOrEmpty(value))
        {
            return DBNull.Value;
        }
        try
        {
            var type = column.DataType.ToUpperInvariant();
            if (type is "NUMBER" or "DECIMAL" or "NUMERIC") return OracleDecimal.Parse(value);
            if (type is "BINARY_FLOAT") return float.Parse(value, NumberStyles.Float, CultureInfo.InvariantCulture);
            if (type is "BINARY_DOUBLE" or "FLOAT") return double.Parse(value, NumberStyles.Float, CultureInfo.InvariantCulture);
            if (type is "DATE") return DateTime.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            if (type.StartsWith("TIMESTAMP") && type.Contains("TIME ZONE")) return DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            if (type.StartsWith("TIMESTAMP")) return DateTime.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            if (type is "RAW" or "LONG RAW" or "BLOB") return Convert.FromBase64String(value.StartsWith("base64:", StringComparison.Ordinal) ? value[7..] : value);
            return value;
        }
        catch (Exception error) when (error is FormatException or OverflowException)
        {
            throw new SidecarException("oracle-import-value-invalid", $"Oracle CSV value for column {column.Name} is not valid for {column.DataType}.");
        }
    }

    private static OracleDbType OracleTypeFor(string dataType)
    {
        var type = dataType.ToUpperInvariant();
        if (type is "NUMBER" or "DECIMAL" or "NUMERIC") return OracleDbType.Decimal;
        if (type is "BINARY_FLOAT") return OracleDbType.BinaryFloat;
        if (type is "BINARY_DOUBLE" or "FLOAT") return OracleDbType.BinaryDouble;
        if (type is "DATE") return OracleDbType.Date;
        if (type.StartsWith("TIMESTAMP") && type.Contains("LOCAL TIME ZONE")) return OracleDbType.TimeStampLTZ;
        if (type.StartsWith("TIMESTAMP") && type.Contains("TIME ZONE")) return OracleDbType.TimeStampTZ;
        if (type.StartsWith("TIMESTAMP")) return OracleDbType.TimeStamp;
        if (type is "RAW" or "LONG RAW") return OracleDbType.Raw;
        if (type is "BLOB") return OracleDbType.Blob;
        if (type is "CLOB" or "NCLOB") return OracleDbType.Clob;
        if (type is "NCHAR" or "NVARCHAR2") return OracleDbType.NVarchar2;
        return OracleDbType.Varchar2;
    }

    private static async Task<string?> ReadTransferCellAsync(OracleDataReader reader, int index, CancellationToken cancellationToken)
    {
        if (await reader.IsDBNullAsync(index, cancellationToken)) return null;
        var value = reader.GetValue(index);
        return value switch
        {
            byte[] bytes => $"base64:{Convert.ToBase64String(bytes)}",
            OracleBlob blob => $"base64:{Convert.ToBase64String(blob.Value)}",
            OracleClob clob => clob.Value,
            DateTime dateTime => dateTime.ToString("O", CultureInfo.InvariantCulture),
            DateTimeOffset offset => offset.ToString("O", CultureInfo.InvariantCulture),
            OracleDate date => date.Value.ToString("O", CultureInfo.InvariantCulture),
            OracleTimeStamp timestamp => timestamp.Value.ToString("O", CultureInfo.InvariantCulture),
            OracleTimeStampLTZ timestamp => timestamp.Value.ToString("O", CultureInfo.InvariantCulture),
            OracleTimeStampTZ timestamp => timestamp.ToString(),
            OracleDecimal number => number.ToString(),
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString(),
        };
    }

    private static async Task WriteCsvRowAsync(StreamWriter writer, IEnumerable<string?> values, CancellationToken cancellationToken)
    {
        var first = true;
        foreach (var value in values)
        {
            if (!first) await writer.WriteAsync(",".AsMemory(), cancellationToken);
            first = false;
            if (value is null) continue;
            var escaped = value.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;
            await writer.WriteAsync(escaped.AsMemory(), cancellationToken);
        }
        await writer.WriteAsync(Environment.NewLine.AsMemory(), cancellationToken);
    }

    private static (string Schema, string Table, string Path) RequiredCsvTransfer(OracleRequest request)
    {
        if (!string.Equals(request.Format, "csv", StringComparison.OrdinalIgnoreCase))
        {
            throw new SidecarException("oracle-transfer-format-invalid", "Oracle local data transfer currently supports CSV.");
        }
        var schema = RequiredTransferIdentifier(request.Schema, "schema");
        var table = RequiredTransferIdentifier(request.Table, "table");
        var path = request.TransferPath?.Trim();
        if (string.IsNullOrWhiteSpace(path) || path.IndexOfAny(['\0', '\r', '\n']) >= 0)
        {
            throw new SidecarException("oracle-transfer-path-invalid", "Choose a valid local Oracle CSV file.");
        }
        return (schema, table, Path.GetFullPath(path));
    }

    private static string RequiredTransferIdentifier(string? value, string label)
    {
        var result = value?.Trim();
        if (string.IsNullOrWhiteSpace(result) || result.Length > 128 || result.Any(char.IsControl))
        {
            throw new SidecarException("oracle-transfer-target-invalid", $"Oracle transfer requires one valid {label} name.");
        }
        return result;
    }

    private static string QuoteIdentifier(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
    private static string QualifiedName(string schema, string table) => $"{QuoteIdentifier(schema)}.{QuoteIdentifier(table)}";

    private static void TryDeleteTransferFile(string path)
    {
        try { File.Delete(path); } catch { }
    }
}

internal sealed record OracleTransferColumn(string Name, string DataType);
