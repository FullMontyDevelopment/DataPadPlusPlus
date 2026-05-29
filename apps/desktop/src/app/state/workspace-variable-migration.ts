import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { legacyToBraceVariables } from './environment-variables'

export function migrateLegacyVariableTokens(snapshot: WorkspaceSnapshot) {
  for (const connection of snapshot.connections) {
    connection.host = legacyToBraceVariables(connection.host)
    connection.database = connection.database
      ? legacyToBraceVariables(connection.database)
      : connection.database
    connection.auth.username = connection.auth.username
      ? legacyToBraceVariables(connection.auth.username)
      : connection.auth.username
    connection.connectionString = connection.connectionString
      ? legacyToBraceVariables(connection.connectionString)
      : connection.connectionString
    connection.redisOptions = migrateJsonVariableTokens(connection.redisOptions)
    connection.sqliteOptions = migrateJsonVariableTokens(connection.sqliteOptions)
    connection.sqlServerOptions = migrateJsonVariableTokens(connection.sqlServerOptions)
    connection.oracleOptions = migrateJsonVariableTokens(connection.oracleOptions)
    connection.dynamoDbOptions = migrateJsonVariableTokens(connection.dynamoDbOptions)
    connection.cassandraOptions = migrateJsonVariableTokens(connection.cassandraOptions)
    connection.cosmosDbOptions = migrateJsonVariableTokens(connection.cosmosDbOptions)
    connection.searchOptions = migrateJsonVariableTokens(connection.searchOptions)
    connection.timeSeriesOptions = migrateJsonVariableTokens(connection.timeSeriesOptions)
    connection.graphOptions = migrateJsonVariableTokens(connection.graphOptions)
    connection.warehouseOptions = migrateJsonVariableTokens(connection.warehouseOptions)
  }

  for (const tab of snapshot.tabs) {
    tab.queryText = legacyToBraceVariables(tab.queryText)
    tab.scriptText = tab.scriptText ? legacyToBraceVariables(tab.scriptText) : tab.scriptText
    if (tab.testSuite) {
      tab.testSuite = migrateJsonVariableTokens(tab.testSuite)
    }
  }

  for (const closedTab of snapshot.closedTabs) {
    closedTab.queryText = legacyToBraceVariables(closedTab.queryText)
    closedTab.scriptText = closedTab.scriptText
      ? legacyToBraceVariables(closedTab.scriptText)
      : closedTab.scriptText
    if (closedTab.testSuite) {
      closedTab.testSuite = migrateJsonVariableTokens(closedTab.testSuite)
    }
  }

  for (const node of snapshot.libraryNodes) {
    node.queryText = node.queryText ? legacyToBraceVariables(node.queryText) : node.queryText
    node.scriptText = node.scriptText ? legacyToBraceVariables(node.scriptText) : node.scriptText
    if (node.testSuite) {
      node.testSuite = migrateJsonVariableTokens(node.testSuite)
    }
  }

  for (const item of snapshot.savedWork) {
    item.queryText = item.queryText ? legacyToBraceVariables(item.queryText) : item.queryText
  }
}

function migrateJsonVariableTokens<T>(value: T): T {
  if (typeof value === 'string') {
    return legacyToBraceVariables(value) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => migrateJsonVariableTokens(item)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        migrateJsonVariableTokens(child),
      ]),
    ) as T
  }

  return value
}
