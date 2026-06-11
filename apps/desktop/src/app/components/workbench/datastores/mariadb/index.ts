import type { DatastoreWorkbenchSlice } from '../types'
import { getMysqlObjectViewDescriptor } from '../common/sql/MysqlObjectViewDescriptors'
import { MysqlObjectViewInsights } from '../common/sql/MysqlObjectViewInsights'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'

export const mariadbWorkbenchSlice = {
  engine: 'mariadb',
  objectViewWorkspace: RelationalObjectViewWorkspace,
  relationalDescriptor: (kind: string) => getMysqlObjectViewDescriptor(kind, 'mariadb'),
  relationalInsights: MysqlObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
