import type { DatastoreRuntimeSlice } from '../types'
import { wideColumnOperationRequest } from '../common/widecolumn/browser-widecolumn-operations'
import { cassandraDataEditRequest } from './browser-cassandra-data-edit-request'
import {
  cassandraInspectQueryTemplate,
  createCassandraExplorerNodes,
} from './browser-cassandra-explorer'
import { cassandraInspectPayload } from './browser-cassandra-payloads'

export const cassandraRuntimeSlice = {
  engine: 'cassandra',
  explorer: {
    createNodes: createCassandraExplorerNodes,
    inspectQueryTemplate: cassandraInspectQueryTemplate,
    inspectPayload: cassandraInspectPayload,
  },
  operation: {
    buildRequest: wideColumnOperationRequest,
  },
  dataEdit: {
    buildRequest: (_connection, request) => cassandraDataEditRequest(request),
  },
} satisfies DatastoreRuntimeSlice
