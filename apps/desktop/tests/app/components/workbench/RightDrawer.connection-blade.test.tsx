import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ConnectionProfile,
  ConnectionTestResult,
  EnvironmentProfile,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionBlade } from '../../../../src/app/components/workbench/RightDrawer.connection-blade'

describe('ConnectionBlade', () => {
  it('shows loading immediately and replaces a previous connection test result', async () => {
    const testResult = connectionTestResult({
      message: 'Connected with fresh settings.',
      resolvedHost: 'db.internal',
    })
    const pending = deferred<ConnectionTestResult>()
    const onTestConnection = vi.fn(async () => pending.promise)

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={connectionTestResult({ message: 'Old failure.', ok: false })}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.getByText('Old failure.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(screen.getByRole('status')).toHaveTextContent('Testing connection')
    expect(screen.queryByText('Old failure.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Testing...' })).toBeDisabled()

    pending.resolve(testResult)

    await waitFor(() => {
      expect(screen.getByText('Connected with fresh settings.')).toBeInTheDocument()
    })
  })

  it('replaces loading with a failure message when testing rejects', async () => {
    const onTestConnection = vi.fn(async () => {
      throw new Error('Network down')
    })

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(screen.getByRole('status')).toHaveTextContent('Testing connection')

    await waitFor(() => {
      expect(screen.getByText('Connection test failed before a result was returned.')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Test Connection' })).not.toBeDisabled()
  })

  it('keeps typed credentials for testing but clears them after successful save and close actions', async () => {
    const onClose = vi.fn()
    const onSaveConnection = vi.fn(async () => true)
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={onClose}
        onSaveConnection={onSaveConnection}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    const credentialInput = screen.getByLabelText('Password / Credential')

    fireEvent.change(credentialInput, { target: { value: 'do-not-keep-me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id }),
      environment.id,
      'do-not-keep-me',
    )
    expect(credentialInput).toHaveValue('do-not-keep-me')

    fireEvent.change(credentialInput, { target: { value: 'do-not-keep-me-again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(onSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id }),
      'do-not-keep-me-again',
    )
    await waitFor(() => {
      expect(credentialInput).toHaveValue('')
    })

    fireEvent.change(credentialInput, { target: { value: 'close-clears-too' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }))
    expect(onClose).toHaveBeenCalled()
    expect(credentialInput).toHaveValue('')
  })

  it('keeps typed credentials visible when save fails', async () => {
    const onSaveConnection = vi.fn(async () => false)

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={onSaveConnection}
        onTestConnection={vi.fn()}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    const credentialInput = screen.getByLabelText('Password / Credential')
    fireEvent.change(credentialInput, { target: { value: 'keep-this-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(onSaveConnection).toHaveBeenCalled()
    })
    expect(credentialInput).toHaveValue('keep-this-secret')
  })

  it('saves and tests without an environment when None is selected', async () => {
    const onSaveConnection = vi.fn(async () => true)
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={onSaveConnection}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id, environmentIds: [] }),
      '',
      '',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))
    expect(onSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id, environmentIds: [] }),
      '',
    )
  })

  it('keeps stored credentials write-only when editing an existing connection', () => {
    render(
      <ConnectionBlade
        activeConnection={connectionWithStoredSecret}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={vi.fn()}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    const credentialInput = screen.getByLabelText('Password / Credential')

    expect(credentialInput).toHaveValue('')
    expect(credentialInput).toHaveAttribute('placeholder', 'Stored credential')
  })

  it('shows PostgreSQL-native application, session, TLS, and timeout options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={connection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('PostgreSQL connect mode'), {
      target: { value: 'cloud-sql-proxy' },
    })
    fireEvent.change(screen.getByLabelText('PostgreSQL Cloud SQL instance'), {
      target: { value: 'project:region:instance' },
    })
    fireEvent.change(screen.getByLabelText('PostgreSQL application name'), {
      target: { value: 'DataPad++ QA' },
    })
    fireEvent.change(screen.getByLabelText('PostgreSQL target session attributes'), {
      target: { value: 'read-write' },
    })
    fireEvent.change(screen.getByLabelText('PostgreSQL search path'), {
      target: { value: 'analytics, public' },
    })
    fireEvent.click(screen.getByLabelText('TLS'))
    fireEvent.click(screen.getByLabelText('Verify certificate'))
    fireEvent.change(screen.getByLabelText('PostgreSQL CA certificate path'), {
      target: { value: 'C:/certs/root.pem' },
    })
    fireEvent.change(screen.getByLabelText('PostgreSQL client certificate path'), {
      target: { value: 'C:/certs/client.pem' },
    })
    fireEvent.change(screen.getByLabelText('PostgreSQL client key path'), {
      target: { value: 'C:/certs/client.key' },
    })
    fireEvent.change(screen.getByLabelText('Connect timeout ms'), {
      target: { value: '2500' },
    })
    fireEvent.change(screen.getByLabelText('Statement timeout ms'), {
      target: { value: '5000' },
    })
    fireEvent.change(screen.getByLabelText('Lock timeout ms'), {
      target: { value: '1000' },
    })
    fireEvent.change(screen.getByLabelText('Idle transaction ms'), {
      target: { value: '30000' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: connection.id,
        postgresOptions: expect.objectContaining({
          connectMode: 'cloud-sql-proxy',
          cloudSqlInstance: 'project:region:instance',
          applicationName: 'DataPad++ QA',
          targetSessionAttrs: 'read-write',
          searchPath: 'analytics, public',
          useTls: true,
          verifyServerCertificate: true,
          caCertificatePath: 'C:/certs/root.pem',
          clientCertificatePath: 'C:/certs/client.pem',
          clientKeyPath: 'C:/certs/client.key',
          connectTimeoutMs: 2500,
          statementTimeoutMs: 5000,
          lockTimeoutMs: 1000,
          idleInTransactionSessionTimeoutMs: 30_000,
        }),
      }),
      environment.id,
      '',
    )
  })

  it('persists CockroachDB profile metadata and capability toggles', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={cockroachConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('CockroachDB deployment mode'), {
      target: { value: 'cockroach-cloud-dedicated' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB organization'), {
      target: { value: 'DataPad Labs' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB cluster name'), {
      target: { value: 'analytics-crdb' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB cluster id'), {
      target: { value: 'crl-123' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB cloud region'), {
      target: { value: 'aws-us-east-1' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB default region'), {
      target: { value: 'us-east' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB locality'), {
      target: { value: 'region=us-east,az=a' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB server version'), {
      target: { value: 'v24.3' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB build tag'), {
      target: { value: 'v24.3.5' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB auth disabled reason'), {
      target: { value: 'OIDC is plan-only.' },
    })
    fireEvent.change(screen.getByLabelText('CockroachDB TLS disabled reason'), {
      target: { value: 'Custom CA is plan-only.' },
    })
    fireEvent.click(screen.getByLabelText('Ranges'))
    fireEvent.click(screen.getByLabelText('Contention'))
    fireEvent.click(screen.getByLabelText('Certificates'))

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: cockroachConnection.id,
        postgresOptions: expect.objectContaining({
          cockroachDeploymentMode: 'cockroach-cloud-dedicated',
          cockroachOrganization: 'DataPad Labs',
          cockroachClusterName: 'analytics-crdb',
          cockroachClusterId: 'crl-123',
          cockroachCloudRegion: 'aws-us-east-1',
          cockroachDefaultRegion: 'us-east',
          cockroachLocality: 'region=us-east,az=a',
          cockroachServerVersion: 'v24.3',
          cockroachBuildTag: 'v24.3.5',
          cockroachAuthDisabledReason: 'OIDC is plan-only.',
          cockroachTlsDisabledReason: 'Custom CA is plan-only.',
          cockroachCapabilities: expect.objectContaining({
            inspectRanges: false,
            inspectContention: false,
            inspectCertificates: false,
          }),
        }),
      }),
      environment.id,
      '',
    )
  })

  it('persists TimescaleDB profile metadata and capability toggles', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={timescaleConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('TimescaleDB deployment mode'), {
      target: { value: 'timescale-cloud' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB project'), {
      target: { value: 'DataPad Observability' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB service id'), {
      target: { value: 'tsdb-123' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB region'), {
      target: { value: 'aws-us-east-1' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB license'), {
      target: { value: 'timescale' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB extension schema'), {
      target: { value: 'public' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB extension version'), {
      target: { value: '2.15.0' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB server version'), {
      target: { value: 'PostgreSQL 16' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB policy execution disabled reason'), {
      target: { value: 'Policy execution is preview-only.' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB compression disabled reason'), {
      target: { value: 'Owner role required.' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB retention disabled reason'), {
      target: { value: 'Retention can drop chunks.' },
    })
    fireEvent.change(screen.getByLabelText('TimescaleDB continuous aggregate disabled reason'), {
      target: { value: 'Refresh is manually approved.' },
    })
    fireEvent.click(screen.getByLabelText('Compression'))
    fireEvent.click(screen.getByLabelText('Jobs'))
    fireEvent.click(screen.getByLabelText('EXPLAIN ANALYZE'))

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: timescaleConnection.id,
        postgresOptions: expect.objectContaining({
          timescaleDeploymentMode: 'timescale-cloud',
          timescaleProject: 'DataPad Observability',
          timescaleServiceId: 'tsdb-123',
          timescaleRegion: 'aws-us-east-1',
          timescaleLicense: 'timescale',
          timescaleExtensionSchema: 'public',
          timescaleExtensionVersion: '2.15.0',
          timescaleServerVersion: 'PostgreSQL 16',
          timescalePolicyExecutionDisabledReason: 'Policy execution is preview-only.',
          timescaleCompressionDisabledReason: 'Owner role required.',
          timescaleRetentionDisabledReason: 'Retention can drop chunks.',
          timescaleContinuousAggregateDisabledReason: 'Refresh is manually approved.',
          timescaleCapabilities: expect.objectContaining({
            inspectCompression: false,
            inspectJobs: false,
            explainAnalyze: false,
          }),
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows SQL Server auth metadata fields and plan-only disabled reasons', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={sqlServerConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.getByLabelText('SQL Server auth disabled reason')).toHaveTextContent(
      'Service principal authentication needs tenant id, client id',
    )

    fireEvent.change(screen.getByLabelText('SQL Server Azure tenant id'), {
      target: { value: 'tenant-id' },
    })
    fireEvent.change(screen.getByLabelText('SQL Server Azure client id'), {
      target: { value: 'client-id' },
    })
    fireEvent.change(screen.getByLabelText('SQL Server authentication mode'), {
      target: { value: 'azure-ad-managed-identity' },
    })
    fireEvent.change(screen.getByLabelText('SQL Server managed identity client id'), {
      target: { value: 'mi-client' },
    })

    expect(screen.getByLabelText('SQL Server auth disabled reason')).toHaveTextContent(
      'Managed identity client id is saved',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sqlServerConnection.id,
        sqlServerOptions: expect.objectContaining({
          connectMode: 'azure-sql',
          authenticationMode: 'azure-ad-managed-identity',
          azureTenantId: 'tenant-id',
          azureClientId: 'client-id',
          azureManagedIdentityClientId: 'mi-client',
          encryptConnection: true,
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows MySQL-native SSL, socket, session, timeout, and auth metadata fields', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={mysqlConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('MySQL connection mode'), {
      target: { value: 'cloud-sql-proxy' },
    })
    fireEvent.change(screen.getByLabelText('MySQL Cloud SQL instance'), {
      target: { value: 'project:region:instance' },
    })
    fireEvent.change(screen.getByLabelText('MySQL authentication mode'), {
      target: { value: 'cleartext-plugin' },
    })
    expect(screen.getByLabelText('MySQL auth disabled reason')).toHaveTextContent(
      'must require TLS',
    )
    fireEvent.change(screen.getByLabelText('MySQL SSL mode'), {
      target: { value: 'verify-identity' },
    })
    expect(screen.getByLabelText('MySQL auth disabled reason')).toHaveTextContent(
      'mysql_clear_password gate',
    )
    fireEvent.change(screen.getByLabelText('MySQL CA certificate path'), {
      target: { value: 'C:/certs/root.pem' },
    })
    fireEvent.change(screen.getByLabelText('MySQL client certificate path'), {
      target: { value: 'C:/certs/client.pem' },
    })
    fireEvent.change(screen.getByLabelText('MySQL client key path'), {
      target: { value: 'C:/certs/client.key' },
    })
    fireEvent.change(screen.getByLabelText('MySQL charset'), {
      target: { value: 'utf8mb4' },
    })
    fireEvent.change(screen.getByLabelText('MySQL collation'), {
      target: { value: 'utf8mb4_0900_ai_ci' },
    })
    fireEvent.change(screen.getByLabelText('MySQL time zone'), {
      target: { value: '+00:00' },
    })
    fireEvent.change(screen.getByLabelText('Connect timeout ms'), {
      target: { value: '2500' },
    })
    fireEvent.change(screen.getByLabelText('Command timeout ms'), {
      target: { value: '5000' },
    })
    fireEvent.change(screen.getByLabelText('MySQL statement cache capacity'), {
      target: { value: '250' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: mysqlConnection.id,
        mysqlOptions: expect.objectContaining({
          connectMode: 'cloud-sql-proxy',
          cloudSqlInstance: 'project:region:instance',
          authMode: 'cleartext-plugin',
          sslMode: 'verify-identity',
          caCertificatePath: 'C:/certs/root.pem',
          clientCertificatePath: 'C:/certs/client.pem',
          clientKeyPath: 'C:/certs/client.key',
          charset: 'utf8mb4',
          collation: 'utf8mb4_0900_ai_ci',
          timeZone: '+00:00',
          connectTimeoutMs: 2500,
          commandTimeoutMs: 5000,
          statementCacheCapacity: 250,
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows MariaDB-native flavor, session, storage, and auth metadata fields', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={mariaDbConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('MariaDB connection mode'), {
      target: { value: 'managed-mariadb' },
    })
    fireEvent.change(screen.getByLabelText('MariaDB authentication mode'), {
      target: { value: 'iam-token' },
    })
    expect(screen.getByLabelText('MariaDB auth disabled reason')).toHaveTextContent(
      'scoped MariaDB claim',
    )
    fireEvent.change(screen.getByLabelText('MariaDB SSL mode'), {
      target: { value: 'required' },
    })
    fireEvent.change(screen.getByLabelText('MariaDB server flavor'), {
      target: { value: 'mariadb' },
    })
    fireEvent.change(screen.getByLabelText('MariaDB charset'), {
      target: { value: 'utf8mb4' },
    })
    fireEvent.change(screen.getByLabelText('MariaDB collation'), {
      target: { value: 'utf8mb4_unicode_ci' },
    })
    fireEvent.change(screen.getByLabelText('MariaDB SQL mode'), {
      target: { value: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION' },
    })
    fireEvent.change(screen.getByLabelText('MariaDB default storage engine'), {
      target: { value: 'Aria' },
    })
    fireEvent.click(screen.getByLabelText('MariaDB allow local infile'))

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: mariaDbConnection.id,
        mysqlOptions: expect.objectContaining({
          connectMode: 'managed-mariadb',
          authMode: 'iam-token',
          sslMode: 'required',
          serverFlavor: 'mariadb',
          charset: 'utf8mb4',
          collation: 'utf8mb4_unicode_ci',
          sqlMode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION',
          defaultStorageEngine: 'Aria',
          allowLocalInfile: true,
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows DynamoDB-native connection options and keeps secret access keys write-only', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={dynamoConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('DynamoDB connection mode'), {
      target: { value: 'access-keys' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB region'), {
      target: { value: 'us-west-2' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB access key ID'), {
      target: { value: '{{AWS_ACCESS_KEY_ID}}' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB credential'), {
      target: { value: 'secret-access-key' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB return consumed capacity'), {
      target: { value: 'indexes' },
    })
    fireEvent.change(screen.getByLabelText('DynamoDB scan page size'), {
      target: { value: '250' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: dynamoConnection.id,
        dynamoDbOptions: expect.objectContaining({
          connectMode: 'access-keys',
          credentialsProvider: 'static-keys',
          region: 'us-west-2',
          accessKeyId: '{{AWS_ACCESS_KEY_ID}}',
          returnConsumedCapacity: 'indexes',
          scanPageSize: 250,
        }),
      }),
      environment.id,
      'secret-access-key',
    )
  })

  it('shows Cassandra-native contact point and policy options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={cassandraConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Cassandra contact points'), {
      target: { value: 'node-a:9042\nnode-b:9042' },
    })
    fireEvent.change(screen.getByLabelText('Cassandra default keyspace'), {
      target: { value: 'catalog' },
    })
    fireEvent.change(screen.getByLabelText('Cassandra local datacenter'), {
      target: { value: 'dc1' },
    })
    fireEvent.change(screen.getByLabelText('Cassandra consistency level'), {
      target: { value: 'quorum' },
    })
    fireEvent.change(screen.getByLabelText('Cassandra page size'), {
      target: { value: '500' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: cassandraConnection.id,
        host: 'node-a',
        database: 'catalog',
        cassandraOptions: expect.objectContaining({
          contactPoints: ['node-a:9042', 'node-b:9042'],
          defaultKeyspace: 'catalog',
          localDatacenter: 'dc1',
          consistencyLevel: 'quorum',
          pageSize: 500,
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows Cosmos DB-native endpoint, auth, consistency, and region options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={cosmosConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Cosmos DB connection mode'), {
      target: { value: 'account-endpoint' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB account endpoint'), {
      target: { value: 'http://localhost:8081/cosmos' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB database name'), {
      target: { value: 'catalog' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB default container'), {
      target: { value: 'orders' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB credential'), {
      target: { value: 'cosmos-key' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB consistency level'), {
      target: { value: 'bounded-staleness' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB preferred regions'), {
      target: { value: 'North Europe, West Europe' },
    })
    fireEvent.change(screen.getByLabelText('Cosmos DB max item count'), {
      target: { value: '250' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: cosmosConnection.id,
        host: 'http://localhost:8081/cosmos',
        database: 'catalog',
        cosmosDbOptions: expect.objectContaining({
          connectMode: 'account-endpoint',
          authMode: 'account-key',
          accountEndpoint: 'http://localhost:8081/cosmos',
          databaseName: 'catalog',
          containerPrefix: 'orders',
          consistencyLevel: 'bounded-staleness',
          preferredRegions: ['North Europe', 'West Europe'],
          maxItemCount: 250,
        }),
      }),
      environment.id,
      'cosmos-key',
    )
  })

  it('prefills Cosmos DB emulator profiles with the official local endpoint', () => {
    const onTestConnection = vi.fn()
    const localCosmosConnection: ConnectionProfile = {
      ...cosmosConnection,
      host: 'localhost',
      port: 443,
      database: '',
      cosmosDbOptions: {
        connectMode: 'emulator',
        authMode: 'emulator',
      },
    }

    render(
      <ConnectionBlade
        activeConnection={localCosmosConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.getByLabelText('Cosmos DB account endpoint')).toHaveValue(
      'http://localhost:8081',
    )
    expect(screen.getByLabelText('Cosmos DB API')).toHaveValue('nosql')
    expect(screen.getByLabelText('Cosmos DB auth mode')).toHaveValue('emulator')

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'http://localhost:8081',
        port: 8081,
        cosmosDbOptions: expect.objectContaining({
          connectMode: 'emulator',
          api: 'nosql',
          accountEndpoint: 'http://localhost:8081',
          authMode: 'emulator',
          allowSelfSignedEmulatorCertificate: true,
        }),
      }),
      environment.id,
      '',
    )
  })

  it('applies Cosmos DB emulator presets and normalizes bare host ports before testing', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={cosmosConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'DataPad++ fixture' }))

    expect(screen.getByLabelText('Cosmos DB account endpoint')).toHaveValue(
      'http://localhost:8082',
    )
    expect(screen.getByLabelText('Cosmos DB database name')).toHaveValue('datapadplusplus')
    expect(screen.getByLabelText('Cosmos DB default container')).toHaveValue('orders')

    fireEvent.click(screen.getByRole('button', { name: 'Microsoft emulator' }))

    expect(screen.getByLabelText('Cosmos DB account endpoint')).toHaveValue(
      'http://localhost:8081',
    )

    fireEvent.change(screen.getByLabelText('Cosmos DB account endpoint'), {
      target: { value: 'localhost:8082' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'http://localhost:8082',
        port: 8082,
        database: 'datapadplusplus',
        cosmosDbOptions: expect.objectContaining({
          accountEndpoint: 'http://localhost:8082',
          databaseName: 'datapadplusplus',
          authMode: 'emulator',
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows Memcached-native server, protocol, SASL, and timeout options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={memcachedConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Memcached servers'), {
      target: { value: 'cache-a:11212\ncache-b:11211' },
    })
    fireEvent.change(screen.getByLabelText('Memcached protocol'), {
      target: { value: 'binary' },
    })
    fireEvent.change(screen.getByLabelText('Memcached auth mode'), {
      target: { value: 'sasl-plain' },
    })
    fireEvent.change(screen.getByLabelText('Memcached username'), {
      target: { value: '{{CACHE_USER}}' },
    })
    fireEvent.change(screen.getByLabelText('Memcached credential'), {
      target: { value: 'sasl-secret' },
    })
    fireEvent.change(screen.getByLabelText('Memcached namespace prefix'), {
      target: { value: 'catalog:' },
    })
    fireEvent.change(screen.getByLabelText('Memcached default TTL'), {
      target: { value: '120' },
    })
    fireEvent.change(screen.getByLabelText('Memcached connection timeout'), {
      target: { value: '2500' },
    })
    fireEvent.change(screen.getByLabelText('Memcached request timeout'), {
      target: { value: '5000' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: memcachedConnection.id,
        host: 'cache-a',
        port: 11212,
        memcachedOptions: expect.objectContaining({
          servers: ['cache-a:11212', 'cache-b:11211'],
          protocol: 'binary',
          authMode: 'sasl-plain',
          username: '{{CACHE_USER}}',
          namespacePrefix: 'catalog:',
          defaultTtlSeconds: 120,
          connectTimeoutMs: 2500,
          requestTimeoutMs: 5000,
        }),
      }),
      environment.id,
      'sasl-secret',
    )
  })

  it('shows Elasticsearch/OpenSearch-native endpoint, auth, index, and AWS options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={searchConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search connection mode'), {
      target: { value: 'aws-sigv4' },
    })
    fireEvent.change(screen.getByLabelText('Search endpoint URL'), {
      target: { value: 'http://localhost:9200/search' },
    })
    fireEvent.change(screen.getByLabelText('Search default index'), {
      target: { value: 'logs-*' },
    })
    fireEvent.change(screen.getByLabelText('Search AWS region'), {
      target: { value: 'us-west-2' },
    })
    fireEvent.change(screen.getByLabelText('Search AWS service'), {
      target: { value: 'aoss' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: searchConnection.id,
        host: 'http://localhost:9200/search',
        database: 'logs-*',
        searchOptions: expect.objectContaining({
          connectMode: 'aws-sigv4',
          authMode: 'aws-sigv4',
          endpointUrl: 'http://localhost:9200/search',
          defaultIndex: 'logs-*',
          awsRegion: 'us-west-2',
          awsService: 'aoss',
        }),
      }),
      environment.id,
      '',
    )
  })

  it('shows time-series-native endpoint, bucket, token, and query options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={timeSeriesConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Time-series connection mode'), {
      target: { value: 'influx-v2' },
    })
    fireEvent.change(screen.getByLabelText('Time-series endpoint URL'), {
      target: { value: 'http://localhost:8086/influx' },
    })
    fireEvent.change(screen.getByLabelText('InfluxDB organization'), {
      target: { value: 'qa-org' },
    })
    fireEvent.change(screen.getByLabelText('InfluxDB bucket'), {
      target: { value: 'telemetry' },
    })
    fireEvent.change(screen.getByLabelText('Time-series auth mode'), {
      target: { value: 'api-token' },
    })
    fireEvent.change(screen.getByLabelText('Time-series credential'), {
      target: { value: 'influx-token' },
    })
    fireEvent.change(screen.getByLabelText('Time-series query timeout'), {
      target: { value: '180000' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: timeSeriesConnection.id,
        host: 'http://localhost:8086/influx',
        database: 'telemetry',
        timeSeriesOptions: expect.objectContaining({
          connectMode: 'influx-v2',
          endpointUrl: 'http://localhost:8086/influx',
          organization: 'qa-org',
          bucket: 'telemetry',
          authMode: 'api-token',
          queryTimeoutMs: 180_000,
        }),
      }),
      environment.id,
      'influx-token',
    )
  })

  it('shows graph-native endpoint, database, auth, and traversal options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={graphConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Graph connection mode'), {
      target: { value: 'neo4j-http' },
    })
    fireEvent.change(screen.getByLabelText('Graph endpoint URL'), {
      target: { value: 'http://localhost:7474/proxy' },
    })
    fireEvent.change(screen.getByLabelText('Graph database'), {
      target: { value: 'analytics' },
    })
    fireEvent.change(screen.getByLabelText('Graph auth mode'), {
      target: { value: 'basic' },
    })
    fireEvent.change(screen.getByLabelText('Graph username'), {
      target: { value: '{{NEO4J_USER}}' },
    })
    fireEvent.change(screen.getByLabelText('Graph credential'), {
      target: { value: 'neo4j-password' },
    })
    fireEvent.change(screen.getByLabelText('Graph fetch size'), {
      target: { value: '500' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: graphConnection.id,
        host: 'http://localhost:7474/proxy',
        database: 'analytics',
        graphOptions: expect.objectContaining({
          connectMode: 'neo4j-http',
          endpointUrl: 'http://localhost:7474/proxy',
          databaseName: 'analytics',
          authMode: 'basic',
          username: '{{NEO4J_USER}}',
          fetchSize: 500,
        }),
      }),
      environment.id,
      'neo4j-password',
    )
  })

  it('shows warehouse-native endpoint, scope, auth, and cost options', () => {
    const onTestConnection = vi.fn()

    render(
      <ConnectionBlade
        activeConnection={warehouseConnection}
        connectionTest={undefined}
        environments={[environment]}
        onClose={vi.fn()}
        onSaveConnection={vi.fn(async () => true)}
        onTestConnection={onTestConnection}
        onPickLocalDatabaseFile={vi.fn(async () => ({ canceled: true }))}
        onCreateLocalDatabase={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Warehouse connection mode'), {
      target: { value: 'snowflake-sql-api' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse endpoint URL'), {
      target: { value: 'http://localhost:19100/snow' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse database'), {
      target: { value: 'FINANCE' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse auth mode'), {
      target: { value: 'oauth' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse credential'), {
      target: { value: 'snowflake-token' },
    })
    fireEvent.change(screen.getByLabelText('Snowflake schema'), {
      target: { value: 'MART' },
    })
    fireEvent.change(screen.getByLabelText('Snowflake warehouse'), {
      target: { value: 'REPORTING_WH' },
    })
    fireEvent.change(screen.getByLabelText('Warehouse cost limit'), {
      target: { value: '25.5' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: warehouseConnection.id,
        host: 'http://localhost:19100/snow',
        database: 'FINANCE',
        warehouseOptions: expect.objectContaining({
          connectMode: 'snowflake-sql-api',
          endpointUrl: 'http://localhost:19100/snow',
          databaseName: 'FINANCE',
          authMode: 'oauth',
          schemaName: 'MART',
          warehouseName: 'REPORTING_WH',
          costLimitUsd: 25.5,
        }),
      }),
      environment.id,
      'snowflake-token',
    )
  })
})

function connectionTestResult(
  patch: Partial<ConnectionTestResult> = {},
): ConnectionTestResult {
  return {
    ok: true,
    engine: connection.engine,
    message: 'Connection ready.',
    warnings: [],
    resolvedHost: connection.host,
    resolvedDatabase: connection.database,
    ...patch,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#5dd6b0',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  variableDefinitions: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const connection: ConnectionProfile = {
  id: 'conn-postgres',
  name: 'PostgreSQL',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'app',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'PG',
  auth: {
    username: 'app',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const connectionWithStoredSecret: ConnectionProfile = {
  ...connection,
  auth: {
    ...connection.auth,
    secretRef: {
      id: 'secret-connection-password',
      provider: 'os-keyring',
      service: 'datapadplusplus',
      account: 'conn-postgres',
      label: 'PostgreSQL credential',
    },
  },
}

const cockroachConnection: ConnectionProfile = {
  ...connection,
  id: 'conn-cockroach',
  name: 'CockroachDB',
  engine: 'cockroachdb',
  host: 'localhost',
  port: 26257,
  database: 'defaultdb',
  icon: 'cockroachdb',
  auth: {
    ...connection.auth,
    username: 'root',
  },
}

const timescaleConnection: ConnectionProfile = {
  ...connection,
  id: 'conn-timescale',
  name: 'TimescaleDB',
  engine: 'timescaledb',
  family: 'timeseries',
  database: 'metrics',
  icon: 'timescaledb',
  auth: {
    ...connection.auth,
    username: 'app',
  },
}

const sqlServerConnection: ConnectionProfile = {
  id: 'conn-sqlserver',
  name: 'Azure SQL',
  engine: 'sqlserver',
  family: 'sql',
  host: 'server.database.windows.net',
  port: 1433,
  database: 'app',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'sqlserver',
  auth: {
    username: 'app',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: 'azure',
    principal: undefined,
    secretRef: undefined,
  },
  sqlServerOptions: {
    connectMode: 'azure-sql',
    authenticationMode: 'azure-ad-service-principal',
    encryptConnection: true,
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const mysqlConnection: ConnectionProfile = {
  id: 'conn-mysql',
  name: 'MySQL',
  engine: 'mysql',
  family: 'sql',
  host: 'localhost',
  port: 3306,
  database: 'commerce',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'mysql',
  auth: {
    username: 'app',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  mysqlOptions: {
    connectMode: 'tcp',
    authMode: 'password',
    sslMode: 'disabled',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const mariaDbConnection: ConnectionProfile = {
  ...mysqlConnection,
  id: 'conn-mariadb',
  name: 'MariaDB',
  engine: 'mariadb',
  port: 3307,
  icon: 'mariadb',
  mysqlOptions: {
    connectMode: 'tcp',
    authMode: 'password',
    sslMode: 'disabled',
    serverFlavor: 'mariadb',
  },
}

const dynamoConnection: ConnectionProfile = {
  id: 'conn-dynamodb',
  name: 'DynamoDB',
  engine: 'dynamodb',
  family: 'widecolumn',
  host: 'https://dynamodb.us-east-1.amazonaws.com',
  database: 'us-east-1',
  connectionMode: 'cloud-sdk',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'dynamodb',
  auth: {
    cloudProvider: 'aws',
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  dynamoDbOptions: {
    connectMode: 'aws-profile',
    region: 'us-east-1',
    profileName: 'default',
    credentialsProvider: 'profile',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const cassandraConnection: ConnectionProfile = {
  id: 'conn-cassandra',
  name: 'Cassandra',
  engine: 'cassandra',
  family: 'widecolumn',
  host: 'node1',
  port: 9042,
  database: 'app',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cassandra',
  auth: {
    username: 'cassandra',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  cassandraOptions: {
    connectMode: 'contact-points',
    contactPoints: ['node1:9042'],
    defaultKeyspace: 'app',
    localDatacenter: 'datacenter1',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const cosmosConnection: ConnectionProfile = {
  id: 'conn-cosmos',
  name: 'Cosmos DB',
  engine: 'cosmosdb',
  family: 'document',
  host: 'http://localhost:8081',
  port: 8081,
  database: 'catalog',
  connectionMode: 'cloud-sdk',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cosmosdb',
  auth: {
    cloudProvider: 'azure',
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  cosmosDbOptions: {
    connectMode: 'emulator',
    api: 'nosql',
    accountEndpoint: 'http://localhost:8081',
    databaseName: 'catalog',
    authMode: 'emulator',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const memcachedConnection: ConnectionProfile = {
  id: 'conn-memcached',
  name: 'Memcached',
  engine: 'memcached',
  family: 'keyvalue',
  host: 'localhost',
  port: 11211,
  database: undefined,
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'memcached',
  auth: {
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  memcachedOptions: {
    servers: ['localhost:11211'],
    protocol: 'text',
    authMode: 'none',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const searchConnection: ConnectionProfile = {
  id: 'conn-search',
  name: 'Elasticsearch',
  engine: 'elasticsearch',
  family: 'search',
  host: 'localhost',
  port: 9200,
  database: 'catalog-*',
  connectionMode: 'cloud-iam',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'elasticsearch',
  auth: {
    cloudProvider: 'aws',
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  searchOptions: {
    connectMode: 'aws-sigv4',
    endpointUrl: 'http://localhost:9200',
    defaultIndex: 'catalog-*',
    authMode: 'aws-sigv4',
    awsRegion: 'us-east-1',
    awsService: 'es',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const timeSeriesConnection: ConnectionProfile = {
  id: 'conn-influx',
  name: 'InfluxDB',
  engine: 'influxdb',
  family: 'timeseries',
  host: 'localhost',
  port: 8086,
  database: 'telegraf',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'influxdb',
  auth: {
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  timeSeriesOptions: {
    connectMode: 'influx-v1',
    endpointUrl: 'http://localhost:8086',
    bucket: 'telegraf',
    defaultQueryLanguage: 'influxql',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const graphConnection: ConnectionProfile = {
  id: 'conn-neo4j',
  name: 'Neo4j',
  engine: 'neo4j',
  family: 'graph',
  host: 'localhost',
  port: 7474,
  database: 'neo4j',
  connectionMode: 'native',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'neo4j',
  auth: {
    username: 'neo4j',
    authMechanism: undefined,
    sslMode: undefined,
    cloudProvider: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  graphOptions: {
    connectMode: 'neo4j-http',
    endpointUrl: 'http://localhost:7474',
    databaseName: 'neo4j',
    authMode: 'basic',
    defaultQueryLanguage: 'cypher',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

const warehouseConnection: ConnectionProfile = {
  id: 'conn-snowflake',
  name: 'Snowflake',
  engine: 'snowflake',
  family: 'warehouse',
  host: 'account.snowflakecomputing.com',
  port: undefined,
  database: 'ANALYTICS',
  connectionMode: 'cloud-sdk',
  environmentIds: [environment.id],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'snowflake',
  auth: {
    cloudProvider: 'snowflake',
    username: undefined,
    authMechanism: undefined,
    sslMode: undefined,
    principal: undefined,
    secretRef: undefined,
  },
  warehouseOptions: {
    connectMode: 'snowflake-sql-api',
    endpointUrl: 'http://localhost:19100',
    databaseName: 'ANALYTICS',
    schemaName: 'PUBLIC',
    authMode: 'oauth',
    defaultQueryLanguage: 'snowflake-sql',
  },
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}
