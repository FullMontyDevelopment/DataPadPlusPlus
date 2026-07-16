import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

function desktopDevServerIdentity(): Plugin {
  return {
    name: 'datapadplusplus-dev-server-identity',
    configureServer(server) {
      server.middlewares.use(
        '/__datapad_dev_server',
        (request, response, next) => {
          if (request.method !== 'GET') {
            next()
            return
          }

          response.statusCode = 200
          response.setHeader('Content-Type', 'application/json')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify({ app: 'datapadplusplus-desktop', pid: process.pid }))
        },
      )
    },
  }
}

function desktopManualChunks(id: string) {
  const normalizedId = id.replace(/\\/g, '/')

  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/')
  ) {
    return 'react-vendor'
  }

  if (normalizedId.includes('/src/app/components/workbench/')) {
    const objectViewChunk = objectViewManualChunk(normalizedId)
    if (objectViewChunk) {
      return objectViewChunk
    }
  }

  if (normalizedId.includes('/src/services/runtime/')) {
    const runtimeChunk = runtimeManualChunk(normalizedId)
    if (runtimeChunk) {
      return runtimeChunk
    }
  }
}

function runtimeManualChunk(normalizedId: string) {
  if (!normalizedId.includes('/browser-')) {
    return undefined
  }

  if (isRuntimeDatastorePath(normalizedId, 'cassandra')) return 'browser-explorer-cassandra'
  if (isRuntimeDatastorePath(normalizedId, 'cosmosdb')) return 'browser-explorer-cosmos'
  if (isRuntimeDatastorePath(normalizedId, 'dynamodb')) return 'browser-explorer-dynamo'
  if (isRuntimeDatastorePath(normalizedId, 'duckdb')) return 'browser-explorer-duckdb'
  if (isRuntimeDatastorePath(normalizedId, 'influxdb')) return 'browser-explorer-influx'
  if (isRuntimeDatastorePath(normalizedId, 'litedb')) return 'browser-explorer-litedb'
  if (isRuntimeDatastorePath(normalizedId, 'memcached')) return 'browser-explorer-memcached'
  if (isRuntimeDatastorePath(normalizedId, 'mongodb')) return 'browser-explorer-mongo'
  if (isRuntimeDatastorePath(normalizedId, 'oracle')) return 'browser-explorer-oracle'
  if (isRuntimeDatastorePath(normalizedId, 'opentsdb')) return 'browser-explorer-opentsdb'
  if (isRuntimeDatastorePath(normalizedId, 'prometheus')) return 'browser-explorer-prometheus'
  if (isRuntimeDatastorePath(normalizedId, 'sqlite')) return 'browser-explorer-sqlite'
  if (isRuntimeDatastorePath(normalizedId, 'sqlserver')) return 'browser-explorer-sqlserver'

  if (
    isRuntimeDatastorePath(normalizedId, 'postgresql') ||
    isRuntimeDatastorePath(normalizedId, 'cockroachdb') ||
    isRuntimeDatastorePath(normalizedId, 'timescaledb')
  ) {
    return 'browser-explorer-postgres-family'
  }

  if (
    isRuntimeDatastorePath(normalizedId, 'mysql') ||
    isRuntimeDatastorePath(normalizedId, 'mariadb')
  ) {
    return 'browser-explorer-mysql'
  }

  if (
    isRuntimeCommonPath(normalizedId, 'sql') ||
    isRuntimeDatastorePath(normalizedId, 'snowflake') ||
    isRuntimeDatastorePath(normalizedId, 'bigquery')
  ) {
    return 'browser-explorer-sql-payloads'
  }

  if (
    isRuntimeCommonPath(normalizedId, 'keyvalue') ||
    isRuntimeDatastorePath(normalizedId, 'redis') ||
    isRuntimeDatastorePath(normalizedId, 'valkey')
  ) {
    return 'browser-explorer-redis'
  }

  if (
    isRuntimeCommonPath(normalizedId, 'search') ||
    isRuntimeDatastorePath(normalizedId, 'elasticsearch') ||
    isRuntimeDatastorePath(normalizedId, 'opensearch')
  ) {
    return 'browser-explorer-search'
  }

  if (
    isRuntimeCommonPath(normalizedId, 'graph') ||
    isRuntimeDatastorePath(normalizedId, 'neo4j') ||
    isRuntimeDatastorePath(normalizedId, 'neptune') ||
    isRuntimeDatastorePath(normalizedId, 'arango') ||
    isRuntimeDatastorePath(normalizedId, 'janusgraph')
  ) {
    return 'browser-explorer-graph'
  }

  if (
    isRuntimeCommonPath(normalizedId, 'warehouse') ||
    isRuntimeDatastorePath(normalizedId, 'clickhouse')
  ) {
    return 'browser-explorer-warehouse'
  }

  return undefined
}

function objectViewManualChunk(normalizedId: string) {
  if (isWorkbenchDatastorePath(normalizedId, 'mongodb')) {
    return 'object-view-mongo'
  }

  if (
    isWorkbenchCommonPath(normalizedId, 'keyvalue') ||
    isWorkbenchDatastorePath(normalizedId, 'redis') ||
    isWorkbenchDatastorePath(normalizedId, 'valkey')
  ) {
    return 'object-view-redis'
  }

  if (isWorkbenchDatastorePath(normalizedId, 'oracle')) {
    return 'object-view-oracle'
  }

  if (
    isWorkbenchCommonPath(normalizedId, 'sql') ||
    isWorkbenchDatastorePath(normalizedId, 'postgresql') ||
    isWorkbenchDatastorePath(normalizedId, 'cockroachdb') ||
    isWorkbenchDatastorePath(normalizedId, 'timescaledb') ||
    isWorkbenchDatastorePath(normalizedId, 'sqlserver') ||
    isWorkbenchDatastorePath(normalizedId, 'sqlite') ||
    isWorkbenchDatastorePath(normalizedId, 'mysql') ||
    isWorkbenchDatastorePath(normalizedId, 'mariadb') ||
    isWorkbenchDatastorePath(normalizedId, 'duckdb')
  ) {
    return 'object-view-sql'
  }

  if (
    isWorkbenchCommonPath(normalizedId, 'timeseries') ||
    isWorkbenchDatastorePath(normalizedId, 'prometheus') ||
    isWorkbenchDatastorePath(normalizedId, 'influxdb') ||
    isWorkbenchDatastorePath(normalizedId, 'opentsdb')
  ) {
    return 'object-view-timeseries'
  }

  if (
    isWorkbenchCommonPath(normalizedId, 'search') ||
    isWorkbenchDatastorePath(normalizedId, 'elasticsearch') ||
    isWorkbenchDatastorePath(normalizedId, 'opensearch')
  ) {
    return 'object-view-search'
  }

  if (isWorkbenchDatastorePath(normalizedId, 'dynamodb')) {
    return 'object-view-dynamo'
  }

  if (isWorkbenchDatastorePath(normalizedId, 'cassandra')) {
    return 'object-view-cassandra'
  }

  if (isWorkbenchDatastorePath(normalizedId, 'cosmosdb')) {
    return 'object-view-cosmos'
  }

  if (
    isWorkbenchCommonPath(normalizedId, 'graph') ||
    isWorkbenchCommonPath(normalizedId, 'warehouse') ||
    isWorkbenchDatastorePath(normalizedId, 'neo4j') ||
    isWorkbenchDatastorePath(normalizedId, 'neptune') ||
    isWorkbenchDatastorePath(normalizedId, 'arango') ||
    isWorkbenchDatastorePath(normalizedId, 'janusgraph') ||
    isWorkbenchDatastorePath(normalizedId, 'clickhouse') ||
    isWorkbenchDatastorePath(normalizedId, 'snowflake') ||
    isWorkbenchDatastorePath(normalizedId, 'bigquery') ||
    isWorkbenchDatastorePath(normalizedId, 'litedb') ||
    isWorkbenchDatastorePath(normalizedId, 'memcached')
  ) {
    return 'object-view-secondary'
  }

  if (
    normalizedId.includes('/ObjectViewHeader') ||
    normalizedId.includes('/ObjectViewPrimitives') ||
    normalizedId.includes('/ObjectViewFeedbackPanel')
  ) {
    return 'object-view-shared'
  }

  return undefined
}

function isRuntimeDatastorePath(normalizedId: string, engine: string) {
  return normalizedId.includes(`/src/services/runtime/datastores/${engine}/`)
}

function isRuntimeCommonPath(normalizedId: string, family: string) {
  return normalizedId.includes(`/src/services/runtime/datastores/common/${family}/`)
}

function isWorkbenchDatastorePath(normalizedId: string, engine: string) {
  return normalizedId.includes(`/src/app/components/workbench/datastores/${engine}/`)
}

function isWorkbenchCommonPath(normalizedId: string, family: string) {
  return normalizedId.includes(`/src/app/components/workbench/datastores/common/${family}/`)
}

export default defineConfig({
  plugins: [desktopDevServerIdentity(), react()],
  clearScreen: false,
  resolve: {
    alias: {
      '@datapadplusplus/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks: desktopManualChunks,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    css: true,
  },
})
