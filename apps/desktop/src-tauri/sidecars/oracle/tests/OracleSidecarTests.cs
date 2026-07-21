using DataPadPlusPlus.OracleSidecar;
using Xunit;

namespace DataPadPlusPlus.OracleSidecar.Tests;

public sealed class OracleSidecarTests
{
    [Fact]
    public void HealthIsCredentialFreeAndReportsRuntimeMetadata()
    {
        var health = Program.Health();
        var properties = health.GetType().GetProperties()
            .ToDictionary(property => property.Name, property => property.GetValue(health));

        Assert.Equal(1, properties["protocolVersion"]);
        Assert.NotEmpty(Assert.IsType<string>(properties["runtimeVersion"]));
        Assert.NotEmpty(Assert.IsType<string>(properties["driverVersion"]));
        Assert.NotEmpty(Assert.IsType<string>(properties["targetPlatform"]));
        Assert.IsType<bool>(properties["consoleAttached"]);
    }

    [Fact]
    public void SessionContextProbeReportsLiveContainerAndSchemaIdentity()
    {
        foreach (var field in new[]
        {
            "SESSION_USER",
            "CURRENT_SCHEMA",
            "PROXY_USER",
            "DB_NAME",
            "DB_UNIQUE_NAME",
            "CON_NAME",
            "CON_ID",
            "SERVICE_NAME",
        })
        {
            Assert.Contains(field, Program.SessionContextProbe, StringComparison.Ordinal);
        }

        Assert.DoesNotContain("V$PDBS", Program.SessionContextProbe, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SplitterHandlesSqlAndSlashTerminatedPlSql()
    {
        var statements = OracleScriptSplitter.Split("""
            select 1 from dual;
            begin
              dbms_output.put_line('ready; still one block');
            end;
            /
            select 2 from dual;
            """);

        Assert.Equal(3, statements.Count);
        Assert.StartsWith("select 1", statements[0], StringComparison.OrdinalIgnoreCase);
        Assert.StartsWith("begin", statements[1], StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\n/", statements[1], StringComparison.Ordinal);
        Assert.StartsWith("select 2", statements[2], StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("select * from dual", true)]
    [InlineData("with q as (select 1 from dual) select * from q", true)]
    [InlineData("select * from accounts for update", false)]
    [InlineData("begin execute immediate 'drop table t'; end;", false)]
    [InlineData("merge into accounts using dual on (1 = 1) when matched then update set status = 'x'", false)]
    public void ReadOnlyClassifierFailsClosed(string statement, bool expected)
    {
        Assert.Equal(expected, OracleStatementClassifier.IsReadOnly(statement));
    }

    [Fact]
    public void DataSourceSupportsServiceSidTnsAndEasyConnectModes()
    {
        Assert.Contains("(SERVICE_NAME=FREEPDB1)", Program.DataSource(Connection(serviceName: "FREEPDB1")));
        Assert.Contains("(SID=FREE)", Program.DataSource(Connection(connectMode: "sid", sid: "FREE")));
        Assert.Equal("SALES_PDB", Program.DataSource(Connection(tnsAlias: "SALES_PDB")));
        Assert.Equal("dbhost:1521/sales_high", Program.DataSource(Connection(easyConnectString: "dbhost:1521/sales_high")));
    }

    [Fact]
    public void SanitizerRemovesConnectionSecretsAndBoundsErrors()
    {
        var sanitized = Program.SanitizeOracleMessage(
            $"ORA-99999: Password=do-not-show{Environment.NewLine}{new string('x', 2_500)}");

        Assert.DoesNotContain("do-not-show", sanitized, StringComparison.Ordinal);
        Assert.Contains("Password=[redacted]", sanitized, StringComparison.OrdinalIgnoreCase);
        Assert.True(sanitized.Length <= 2_000);
        Assert.DoesNotContain('\n', sanitized);
    }

    private static OracleConnectionInput Connection(
        string? connectMode = "service",
        string? serviceName = null,
        string? sid = null,
        string? tnsAlias = null,
        string? easyConnectString = null) =>
        new(
            Host: "127.0.0.1",
            Port: 1521,
            Database: serviceName,
            Username: "APP",
            Password: "secret",
            ConnectionString: null,
            ConnectMode: connectMode,
            ServiceName: serviceName,
            Sid: sid,
            TnsAlias: tnsAlias,
            EasyConnectString: easyConnectString,
            ConnectionRole: null,
            ProxyUser: null,
            ClientIdentifier: null,
            ApplicationName: "DataPad++",
            Edition: null,
            StatementCacheSize: null,
            ConnectionTimeoutMs: null,
            PoolMin: null,
            PoolMax: null,
            ValidateConnection: null,
            HighAvailabilityEvents: null,
            LoadBalancing: null,
            UseTls: false,
            WalletPath: null,
            WalletPassword: null,
            TnsAdminPath: null,
            CaCertificatePath: null,
            ClientCertificatePath: null,
            ClientKeyPath: null);
}
