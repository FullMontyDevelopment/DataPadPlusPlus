import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  EnvironmentProfile,
  ExplorerNode,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { CassandraObjectViewWorkspace } from './CassandraObjectViewWorkspace'
import { CosmosObjectViewWorkspace } from './CosmosObjectViewWorkspace'
import { DynamoObjectViewWorkspace } from './DynamoObjectViewWorkspace'
import { GenericObjectViewWorkspace } from './GenericObjectViewWorkspace'
import { GraphObjectViewWorkspace } from './GraphObjectViewWorkspace'
import { InfluxObjectViewWorkspace } from './InfluxObjectViewWorkspace'
import { LiteDbObjectViewWorkspace } from './LiteDbObjectViewWorkspace'
import { MemcachedObjectViewWorkspace } from './MemcachedObjectViewWorkspace'
import { MongoObjectViewWorkspace } from './MongoObjectViewWorkspace'
import { OpenTsdbObjectViewWorkspace } from './OpenTsdbObjectViewWorkspace'
import { OracleObjectViewWorkspace } from './OracleObjectViewWorkspace'
import { PrometheusObjectViewWorkspace } from './PrometheusObjectViewWorkspace'
import { RedisObjectViewWorkspace } from './RedisObjectViewWorkspace'
import { RelationalObjectViewWorkspace } from './RelationalObjectViewWorkspace'
import { SearchObjectViewWorkspace } from './SearchObjectViewWorkspace'
import { WarehouseObjectViewWorkspace } from './WarehouseObjectViewWorkspace'

interface ObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onOpenObjectView?(connectionId: string, node: ExplorerNode): void
  onPlanOperation?(request: OperationPlanRequest): Promise<OperationPlanResponse | undefined>
  onExecuteDataEdit?(request: DataEditExecutionRequest): Promise<DataEditExecutionResponse | undefined>
}

export function ObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onOpenObjectView,
  onPlanOperation,
  onExecuteDataEdit,
}: ObjectViewWorkspaceProps) {
  if (connection.engine === 'mongodb') {
    return (
      <MongoObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
        onOpenObjectView={onOpenObjectView}
        onPlanOperation={onPlanOperation}
        onExecuteDataEdit={onExecuteDataEdit}
      />
    )
  }

  if (connection.engine === 'litedb') {
    return (
      <LiteDbObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'cosmosdb') {
    return (
      <CosmosObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return (
      <RedisObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'memcached') {
    return (
      <MemcachedObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
      />
    )
  }

  if (connection.engine === 'oracle') {
    return (
      <OracleObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (
    connection.engine === 'postgresql' ||
    connection.engine === 'cockroachdb' ||
    connection.engine === 'timescaledb' ||
    connection.engine === 'sqlserver' ||
    connection.engine === 'sqlite' ||
    connection.engine === 'duckdb' ||
    connection.engine === 'mysql' ||
    connection.engine === 'mariadb'
  ) {
    return (
      <RelationalObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return (
      <SearchObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.family === 'graph') {
    return (
      <GraphObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.family === 'warehouse') {
    return (
      <WarehouseObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'prometheus') {
    return (
      <PrometheusObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'influxdb') {
    return (
      <InfluxObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'opentsdb') {
    return (
      <OpenTsdbObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'dynamodb') {
    return (
      <DynamoObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'cassandra') {
    return (
      <CassandraObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  return (
    <GenericObjectViewWorkspace
      connection={connection}
      environment={environment}
      tab={tab}
      onRefresh={onRefresh}
    />
  )
}
