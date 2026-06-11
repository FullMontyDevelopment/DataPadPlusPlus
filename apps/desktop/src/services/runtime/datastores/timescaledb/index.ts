import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { DatastoreRuntimeSlice } from '../types'
import {
  parsePostgresNodeId,
  postgresColumns,
} from '../common/sql/browser-postgres-family-helpers'
import { postgresInspectPayload } from '../common/sql/browser-postgres-family-payloads'
import { createTimescaleExplorerNodes } from './browser-timescale-explorer'
import {
  timescaleDataEditRequest,
  timescaleDataEditWarnings,
} from './browser-timescale-data-edit-request'
import { timescaleOperationRequest } from './browser-timescale-operations'
import {
  timescaleInspectPayload,
  timescaleInspectQueryTemplate,
} from './browser-timescale-payloads'

export const timescaledbRuntimeSlice = {
  engine: 'timescaledb',
  explorer: {
    createNodes: createTimescaleExplorerNodes,
    inspectQueryTemplate: timescaleQueryTemplate,
    inspectPayload: timescalePayload,
  },
  operation: {
    buildRequest: timescaleOperationRequest,
  },
  dataEdit: {
    buildRequest: (_connection, request) => timescaleDataEditRequest(request),
    warnings: (_connection, request) => timescaleDataEditWarnings(request),
  },
} satisfies DatastoreRuntimeSlice

function timescaleQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parsePostgresNodeId(connection, nodeId)
  return timescaleInspectQueryTemplate(nodeId, schema, objectName)
}

function timescalePayload(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parsePostgresNodeId(connection, nodeId)
  return timescaleInspectPayload(
    connection,
    {
      engine: connection.engine,
      database: connection.database || 'datapadplusplus',
      schema,
      objectName,
    },
    nodeId,
    schema,
    objectName,
    postgresColumns(),
  ) ?? postgresInspectPayload(connection, nodeId)
}
