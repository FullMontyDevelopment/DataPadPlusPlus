import type { DatastoreWorkbenchSlice } from '../types'
import { getMysqlObjectViewDescriptor } from '../common/sql/MysqlObjectViewDescriptors'
import { MysqlObjectViewInsights } from '../common/sql/MysqlObjectViewInsights'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'

export const mysqlWorkbenchSlice = {
  engine: 'mysql',
  objectViewWorkspace: RelationalObjectViewWorkspace,
  relationalDescriptor: (kind: string) => getMysqlObjectViewDescriptor(kind, 'mysql'),
  relationalInsights: MysqlObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
