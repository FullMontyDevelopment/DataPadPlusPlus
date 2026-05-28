import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

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

  if (normalizedId.includes('/browser-cassandra-explorer')) return 'browser-explorer-cassandra'
  if (normalizedId.includes('/browser-cassandra-fixtures')) return 'browser-explorer-cassandra'
  if (normalizedId.includes('/browser-cassandra-helpers')) return 'browser-explorer-cassandra'
  if (normalizedId.includes('/browser-cassandra-payloads')) return 'browser-explorer-cassandra'
  if (normalizedId.includes('/browser-cosmos-explorer')) return 'browser-explorer-cosmos'
  if (normalizedId.includes('/browser-dynamo-explorer')) return 'browser-explorer-dynamo'
  if (normalizedId.includes('/browser-duckdb-explorer')) return 'browser-explorer-duckdb'
  if (normalizedId.includes('/browser-graph-explorer')) return 'browser-explorer-graph'
  if (normalizedId.includes('/browser-influx-explorer')) return 'browser-explorer-influx'
  if (normalizedId.includes('/browser-influx-fixtures')) return 'browser-explorer-influx'
  if (normalizedId.includes('/browser-litedb-explorer')) return 'browser-explorer-litedb'
  if (normalizedId.includes('/browser-memcached-explorer')) return 'browser-explorer-memcached'
  if (normalizedId.includes('/browser-mysql-explorer')) return 'browser-explorer-mysql'
  if (normalizedId.includes('/browser-mysql-fixtures')) return 'browser-explorer-mysql'
  if (normalizedId.includes('/browser-mysql-helpers')) return 'browser-explorer-mysql'
  if (normalizedId.includes('/browser-mysql-payloads')) return 'browser-explorer-mysql'
  if (normalizedId.includes('/browser-mongo-explorer')) return 'browser-explorer-mongo'
  if (normalizedId.includes('/browser-mongo-helpers')) return 'browser-explorer-mongo'
  if (normalizedId.includes('/browser-mongo-payloads')) return 'browser-explorer-mongo'
  if (normalizedId.includes('/browser-mongo-query-templates')) return 'browser-explorer-mongo'
  if (normalizedId.includes('/browser-oracle-explorer')) return 'browser-explorer-oracle'
  if (normalizedId.includes('/browser-opentsdb-explorer')) return 'browser-explorer-opentsdb'
  if (normalizedId.includes('/browser-opentsdb-fixtures')) return 'browser-explorer-opentsdb'
  if (normalizedId.includes('/browser-prometheus-explorer')) return 'browser-explorer-prometheus'
  if (normalizedId.includes('/browser-prometheus-fixtures')) return 'browser-explorer-prometheus'
  if (normalizedId.includes('/browser-postgres-family-explorer')) return 'browser-explorer-postgres-family'
  if (normalizedId.includes('/browser-postgres-family-helpers')) return 'browser-explorer-postgres-family'
  if (normalizedId.includes('/browser-postgres-family-payloads')) return 'browser-explorer-postgres-family'
  if (normalizedId.includes('/browser-relational-source-payloads')) return 'browser-explorer-sql-payloads'
  if (normalizedId.includes('/browser-redis-explorer')) return 'browser-explorer-redis'
  if (normalizedId.includes('/browser-redis-helpers')) return 'browser-explorer-redis'
  if (normalizedId.includes('/browser-redis-payloads')) return 'browser-explorer-redis'
  if (normalizedId.includes('/browser-search-explorer')) return 'browser-explorer-search'
  if (normalizedId.includes('/browser-search-fixtures')) return 'browser-explorer-search'
  if (normalizedId.includes('/browser-search-payloads')) return 'browser-explorer-search'
  if (normalizedId.includes('/browser-sqlite-explorer')) return 'browser-explorer-sqlite'
  if (normalizedId.includes('/browser-sqlite-fixtures')) return 'browser-explorer-sqlite'
  if (normalizedId.includes('/browser-sqlite-payloads')) return 'browser-explorer-sqlite'
  if (normalizedId.includes('/browser-sqlserver-explorer')) return 'browser-explorer-sqlserver'
  if (normalizedId.includes('/browser-sqlserver-helpers')) return 'browser-explorer-sqlserver'
  if (normalizedId.includes('/browser-sqlserver-payloads')) return 'browser-explorer-sqlserver'
  if (normalizedId.includes('/browser-warehouse-explorer')) return 'browser-explorer-warehouse'

  return undefined
}

function objectViewManualChunk(normalizedId: string) {
  if (!normalizedId.includes('ObjectView')) {
    return undefined
  }

  if (normalizedId.includes('/Mongo')) {
    return 'object-view-mongo'
  }

  if (normalizedId.includes('/Redis')) {
    return 'object-view-redis'
  }

  if (normalizedId.includes('/Oracle')) {
    return 'object-view-oracle'
  }

  if (
    normalizedId.includes('/Relational') ||
    normalizedId.includes('/Postgres') ||
    normalizedId.includes('/Cockroach') ||
    normalizedId.includes('/SqlServer') ||
    normalizedId.includes('/Sqlite') ||
    normalizedId.includes('/Mysql') ||
    normalizedId.includes('/DuckDb')
  ) {
    return 'object-view-sql'
  }

  if (
    normalizedId.includes('/Prometheus') ||
    normalizedId.includes('/Influx') ||
    normalizedId.includes('/OpenTsdb')
  ) {
    return 'object-view-timeseries'
  }

  if (normalizedId.includes('/Search')) {
    return 'object-view-search'
  }

  if (normalizedId.includes('/Dynamo')) {
    return 'object-view-dynamo'
  }

  if (normalizedId.includes('/Cassandra')) {
    return 'object-view-cassandra'
  }

  if (normalizedId.includes('/Cosmos')) {
    return 'object-view-cosmos'
  }

  if (
    normalizedId.includes('/Graph') ||
    normalizedId.includes('/Warehouse') ||
    normalizedId.includes('/LiteDb') ||
    normalizedId.includes('/Memcached')
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

export default defineConfig({
  plugins: [react()],
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
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
