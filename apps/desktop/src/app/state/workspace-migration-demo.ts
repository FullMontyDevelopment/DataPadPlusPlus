import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'

const DEMO_CONNECTION_IDS = new Set([
  'conn-analytics',
  'conn-orders',
  'conn-catalog',
  'conn-commerce',
  'conn-local-sqlite',
  'conn-cache',
])
const DEMO_ENVIRONMENT_IDS = new Set(['env-dev', 'env-uat', 'env-prod'])
const DEMO_TAB_IDS = new Set([
  'tab-sql-ops',
  'tab-orders-audit',
  'tab-mongo-catalog',
  'tab-commerce-mysql',
  'tab-local-sqlite',
  'tab-redis-session',
])
const DEMO_SAVED_WORK_IDS = new Set(['saved-locks', 'saved-hotkeys', 'saved-catalog'])

export function stripDemoRecords(snapshot: WorkspaceSnapshot) {
  snapshot.connections = snapshot.connections.filter(
    (connection) => !DEMO_CONNECTION_IDS.has(connection.id),
  )
  snapshot.tabs = snapshot.tabs.filter((tab) => !DEMO_TAB_IDS.has(tab.id))
  snapshot.closedTabs = (snapshot.closedTabs ?? []).filter((tab) => !DEMO_TAB_IDS.has(tab.id))
  snapshot.savedWork = snapshot.savedWork.filter((item) => !DEMO_SAVED_WORK_IDS.has(item.id))
  snapshot.libraryNodes = snapshot.libraryNodes.filter((item) => !DEMO_SAVED_WORK_IDS.has(item.id))
  snapshot.explorerNodes = snapshot.explorerNodes.filter((node) => !node.id.startsWith('explorer-'))
  snapshot.guardrails = []

  const referencedEnvironmentIds = new Set<string>()
  snapshot.connections.forEach((connection) => {
    connection.environmentIds.forEach((environmentId) => referencedEnvironmentIds.add(environmentId))
  })
  snapshot.tabs.forEach((tab) => referencedEnvironmentIds.add(tab.environmentId))
  snapshot.closedTabs.forEach((tab) => referencedEnvironmentIds.add(tab.environmentId))
  snapshot.savedWork.forEach((item) => {
    if (item.environmentId) referencedEnvironmentIds.add(item.environmentId)
  })
  snapshot.libraryNodes.forEach((item) => {
    if (item.environmentId) referencedEnvironmentIds.add(item.environmentId)
  })
  snapshot.environments = snapshot.environments.filter(
    (environment) =>
      !DEMO_ENVIRONMENT_IDS.has(environment.id) || referencedEnvironmentIds.has(environment.id),
  )
}
