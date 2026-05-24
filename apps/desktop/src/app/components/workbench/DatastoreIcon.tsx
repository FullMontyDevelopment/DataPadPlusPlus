import type { CSSProperties, ReactNode } from 'react'
import type { DatastoreEngine } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import apacheCassandraIcon from 'simple-icons/icons/apachecassandra.svg?raw'
import arangoDbIcon from 'simple-icons/icons/arangodb.svg?raw'
import clickHouseIcon from 'simple-icons/icons/clickhouse.svg?raw'
import cockroachLabsIcon from 'simple-icons/icons/cockroachlabs.svg?raw'
import duckDbIcon from 'simple-icons/icons/duckdb.svg?raw'
import elasticsearchIcon from 'simple-icons/icons/elasticsearch.svg?raw'
import googleBigQueryIcon from 'simple-icons/icons/googlebigquery.svg?raw'
import influxDbIcon from 'simple-icons/icons/influxdb.svg?raw'
import mariaDbIcon from 'simple-icons/icons/mariadb.svg?raw'
import mongoDbIcon from 'simple-icons/icons/mongodb.svg?raw'
import mySqlIcon from 'simple-icons/icons/mysql.svg?raw'
import neo4jIcon from 'simple-icons/icons/neo4j.svg?raw'
import openSearchIcon from 'simple-icons/icons/opensearch.svg?raw'
import postgreSqlIcon from 'simple-icons/icons/postgresql.svg?raw'
import prometheusIcon from 'simple-icons/icons/prometheus.svg?raw'
import redisIcon from 'simple-icons/icons/redis.svg?raw'
import snowflakeIcon from 'simple-icons/icons/snowflake.svg?raw'
import sqliteIcon from 'simple-icons/icons/sqlite.svg?raw'
import timescaleIcon from 'simple-icons/icons/timescale.svg?raw'

type IconVariant =
  | 'analytics-bars'
  | 'atom'
  | 'cache-chip'
  | 'clock-database'
  | 'cloud-table'
  | 'column-bars'
  | 'document-file'
  | 'duck'
  | 'elephant'
  | 'feather'
  | 'flame'
  | 'graph'
  | 'graph-orbit'
  | 'hex-bug'
  | 'leaf'
  | 'mysql-wave'
  | 'oracle-ring'
  | 'ring-dots'
  | 'search-orbit'
  | 'search-wave'
  | 'snowflake'
  | 'sql-cylinder'
  | 'stacked-layers'
  | 'waveform'

interface DatastoreIconMeta {
  color: string
  accent: string
  variant?: IconVariant
  brandIcon?: BrandIcon
}

interface BrandIcon {
  hex: string
  path: string
}

const DATASTORE_ICON_META: Record<DatastoreEngine, DatastoreIconMeta> = {
  arango: brandIcon(arangoDbIcon, 'DDDF72', '#a6df5b'),
  bigquery: brandIcon(googleBigQueryIcon, '669DF6', '#fbbc04'),
  cassandra: brandIcon(apacheCassandraIcon, '1287B1', '#7fd8ff'),
  clickhouse: brandIcon(clickHouseIcon, 'FFCC01', '#d9362b'),
  cockroachdb: brandIcon(cockroachLabsIcon, '6933FF', '#b59cff'),
  cosmosdb: { color: '#0078d4', accent: '#7fd8ff', variant: 'atom' },
  duckdb: brandIcon(duckDbIcon, 'FFF000', '#2f2f2f'),
  dynamodb: { color: '#ff9900', accent: '#5a35f0', variant: 'cloud-table' },
  elasticsearch: brandIcon(elasticsearchIcon, '005571', '#f6d74a'),
  influxdb: brandIcon(influxDbIcon, '22ADF6', '#17d4ff'),
  janusgraph: { color: '#6f7c91', accent: '#b7c4d8', variant: 'graph-orbit' },
  litedb: { color: '#8d6e63', accent: '#d7ccc8', variant: 'document-file' },
  mariadb: brandIcon(mariaDbIcon, '003545', '#1f6b82'),
  memcached: { color: '#4e9a06', accent: '#b7e06a', variant: 'cache-chip' },
  mongodb: brandIcon(mongoDbIcon, '47A248', '#8cc84b'),
  mysql: brandIcon(mySqlIcon, '4479A1', '#f29111'),
  neo4j: brandIcon(neo4jIcon, '4581C3', '#79c000'),
  neptune: { color: '#5c6bc0', accent: '#00bcd4', variant: 'graph-orbit' },
  opensearch: brandIcon(openSearchIcon, '005EB8', '#00a3e0'),
  opentsdb: { color: '#34495e', accent: '#f39c12', variant: 'waveform' },
  oracle: { color: '#f80000', accent: '#ffb3b3', variant: 'oracle-ring' },
  postgresql: brandIcon(postgreSqlIcon, '4169E1', '#8db3d3'),
  prometheus: brandIcon(prometheusIcon, 'E6522C', '#f9a03f'),
  redis: brandIcon(redisIcon, 'FF4438', '#ffb000'),
  snowflake: brandIcon(snowflakeIcon, '29B5E8', '#b8f0ff'),
  sqlite: brandIcon(sqliteIcon, '003B57', '#8fd1ff'),
  sqlserver: { color: '#cc2927', accent: '#f2c94c', variant: 'sql-cylinder' },
  timescaledb: brandIcon(timescaleIcon, 'FDB515', '#274690'),
  valkey: { color: '#1f9d8a', accent: '#65d6c3', variant: 'stacked-layers' },
}

function brandIcon(svg: string, hex: string, accent: string): DatastoreIconMeta {
  return {
    color: `#${hex}`,
    accent,
    brandIcon: {
      hex,
      path: svgPath(svg),
    },
  }
}

function svgPath(svg: string) {
  return /<path d="([^"]+)"/.exec(svg)?.[1] ?? ''
}

export function DatastoreIcon({
  className,
  decorative = true,
  engine,
  label,
}: {
  className?: string
  decorative?: boolean
  engine: DatastoreEngine
  label?: string
}) {
  const meta = DATASTORE_ICON_META[engine]
  const iconLabel =
    label ?? `${datastoreBacklogByEngine(engine)?.displayName ?? engine} datastore icon`

  return (
    <span
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : iconLabel}
      className={`datastore-icon${meta.brandIcon ? ' datastore-icon--brand' : ' datastore-icon--fallback'}${className ? ` ${className}` : ''}`}
      role={decorative ? undefined : 'img'}
      style={
        {
          '--datastore-icon-color': meta.color,
          '--datastore-icon-accent': meta.accent,
        } as CSSProperties
      }
    >
      <svg
        aria-hidden="true"
        className="datastore-icon-svg"
        focusable="false"
        viewBox="0 0 24 24"
      >
        {meta.brandIcon
          ? renderBrandIcon(meta.brandIcon)
          : renderIcon(meta.variant ?? 'sql-cylinder')}
      </svg>
    </span>
  )
}

function renderBrandIcon(icon: BrandIcon): ReactNode {
  return <path className="datastore-icon-brand-path" d={icon.path} />
}

function renderIcon(variant: IconVariant): ReactNode {
  switch (variant) {
    case 'analytics-bars':
      return (
        <>
          <path className="datastore-icon-accent-fill" d="M5 17h3v-5H5zM10.5 17h3V7h-3zM16 17h3V4h-3z" />
          <path className="datastore-icon-stroke" d="M4 19h16M5 9l4 2.5 3.5-5L19 3.5" />
        </>
      )
    case 'atom':
      return (
        <>
          <circle className="datastore-icon-accent-fill" cx="12" cy="12" r="2.3" />
          <ellipse className="datastore-icon-stroke" cx="12" cy="12" rx="8" ry="3.2" />
          <ellipse className="datastore-icon-stroke" cx="12" cy="12" rx="8" ry="3.2" transform="rotate(60 12 12)" />
          <ellipse className="datastore-icon-stroke" cx="12" cy="12" rx="8" ry="3.2" transform="rotate(120 12 12)" />
        </>
      )
    case 'cache-chip':
      return (
        <>
          <rect className="datastore-icon-fill" x="6" y="6" width="12" height="12" rx="2.2" />
          <path className="datastore-icon-background-stroke" d="M9 10h6M9 14h4M4 8h2M4 12h2M4 16h2M18 8h2M18 12h2M18 16h2M8 4v2M12 4v2M16 4v2M8 18v2M12 18v2M16 18v2" />
        </>
      )
    case 'clock-database':
      return (
        <>
          {databaseCylinder()}
          <circle className="datastore-icon-accent-stroke" cx="15" cy="9" r="5" />
          <path className="datastore-icon-accent-stroke" d="M15 6v3l2 1.5" />
        </>
      )
    case 'cloud-table':
      return (
        <>
          <path className="datastore-icon-fill" d="M7.5 17.5h9.2a3.3 3.3 0 0 0 .5-6.6A5.2 5.2 0 0 0 7.1 9a3.9 3.9 0 0 0 .4 8.5Z" />
          <path className="datastore-icon-background-stroke" d="M8 12h8M8 15h8M11 10v7M14 10v7" />
        </>
      )
    case 'column-bars':
      return (
        <>
          <rect className="datastore-icon-fill" x="4" y="4" width="3.2" height="16" rx="1" />
          <rect className="datastore-icon-fill" x="8.5" y="4" width="3.2" height="16" rx="1" />
          <rect className="datastore-icon-fill" x="13" y="4" width="3.2" height="16" rx="1" />
          <rect className="datastore-icon-accent-fill" x="17.5" y="4" width="2.5" height="16" rx="1" />
        </>
      )
    case 'document-file':
      return (
        <>
          <path className="datastore-icon-fill" d="M7 3.8h7.2L18 7.6v12.6H7z" />
          <path className="datastore-icon-background-stroke" d="M14 4v4h4M9 11h6M9 14h5M9 17h4" />
        </>
      )
    case 'duck':
      return (
        <>
          <path className="datastore-icon-fill" d="M6.5 15.8c2.2 2.8 8.5 2.9 11.3.1 1-1 1.3-2.4.5-3.4-.8-1-2.2-.8-3.4-.2-.5-2.6-2-5-4.6-5-2 0-3.2 1.4-3.2 3.1 0 1 .4 1.8 1.1 2.4-1.6.2-2.7 1-1.7 3Z" />
          <path className="datastore-icon-accent-fill" d="M14.6 8.2 20 7.4l-3.9 2.7z" />
          <circle className="datastore-icon-background-fill" cx="10.7" cy="9.6" r="0.8" />
        </>
      )
    case 'elephant':
      return (
        <>
          <path className="datastore-icon-fill" d="M5.2 12.4c0-4 3.1-7.1 7.3-7.1 4 0 6.4 2.7 6.4 6.4 0 2.4-1.1 4.1-3.1 5.2v2.2c0 1.2-.8 2-2 2h-2.1v-3.3H9.2c-2.4 0-4-2.1-4-5.4Z" />
          <path className="datastore-icon-background-stroke" d="M10.2 9.5c-1.8-.5-3 .4-3.4 2.2M13.8 8.2c2 1.3 2.2 4 .3 5.9-1.2 1.2-.8 3 .8 3.2M11.7 17.8v-3.1" />
          <circle className="datastore-icon-background-fill" cx="14.7" cy="10.2" r="0.8" />
        </>
      )
    case 'feather':
      return (
        <>
          <path className="datastore-icon-fill" d="M6.2 18.7C7.1 11.2 11.5 5.8 19 3.8c-.6 7.6-5.2 12.4-12.8 14.9Z" />
          <path className="datastore-icon-background-stroke" d="M7.5 17.2 17.2 6.5M10 14.7h4.4M11.7 12.7h3.8" />
        </>
      )
    case 'flame':
      return (
        <>
          <path className="datastore-icon-fill" d="M12 21c-3.5 0-6.1-2.4-6.1-5.8 0-2.4 1.2-4.1 3-5.7.9-.8 1.6-2 1.6-3.6 2.8 1.2 4.6 3.3 4.5 6.2.9-.5 1.5-1.3 1.8-2.4 1.2 1.2 1.9 2.9 1.9 4.8C18.7 18.3 15.8 21 12 21Z" />
          <path className="datastore-icon-accent-fill" d="M12.2 18.7c-1.4 0-2.5-.9-2.5-2.3 0-1 .5-1.7 1.2-2.4.5-.5.9-1.1.9-1.9 1.7 1 2.7 2.1 2.7 3.8 0 1.6-.9 2.8-2.3 2.8Z" />
        </>
      )
    case 'graph':
      return graphMark(false)
    case 'graph-orbit':
      return graphMark(true)
    case 'hex-bug':
      return (
        <>
          <path className="datastore-icon-fill" d="m12 3.8 7.1 4.1v8.2L12 20.2l-7.1-4.1V7.9z" />
          <path className="datastore-icon-background-stroke" d="M8.5 11.5h7M9 8.2l2 2M15 8.2l-2 2M8.4 14.6l-2 1.2M15.6 14.6l2 1.2M12 10.3v6.1" />
          <circle className="datastore-icon-background-fill" cx="10" cy="12.5" r="0.7" />
          <circle className="datastore-icon-background-fill" cx="14" cy="12.5" r="0.7" />
        </>
      )
    case 'leaf':
      return (
        <>
          <path className="datastore-icon-fill" d="M12.4 20.4C8.1 17.2 6.2 13.7 7 10.1 7.9 6.1 11.4 4 18.4 3.8c.5 6.9-1.5 11.3-6 16.6Z" />
          <path className="datastore-icon-background-stroke" d="M12.2 18.2c.3-4 .9-7.1 3.7-11.3" />
        </>
      )
    case 'mysql-wave':
      return (
        <>
          <path className="datastore-icon-fill" d="M4.5 15.1c3.2-5.7 8.2-7.7 15.2-6-2.8 6.2-8 8.5-15.2 6Z" />
          <path className="datastore-icon-accent-stroke" d="M6 15.6c4.5 1.2 8.3.3 11.7-2.8M8.3 13.1c1.7-1.1 3.8-1.3 6.3-.6" />
          <circle className="datastore-icon-background-fill" cx="16" cy="10.4" r="0.8" />
        </>
      )
    case 'oracle-ring':
      return (
        <>
          <rect className="datastore-icon-stroke-thick" x="4.7" y="7.2" width="14.6" height="9.6" rx="4.8" />
          <path className="datastore-icon-accent-stroke" d="M8.7 12h6.6" />
        </>
      )
    case 'ring-dots':
      return (
        <>
          <circle className="datastore-icon-stroke" cx="12" cy="12" r="6.1" />
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <circle
              key={angle}
              className="datastore-icon-accent-fill"
              cx={12 + Math.cos((angle * Math.PI) / 180) * 6.1}
              cy={12 + Math.sin((angle * Math.PI) / 180) * 6.1}
              r="1.45"
            />
          ))}
        </>
      )
    case 'search-orbit':
      return (
        <>
          <path className="datastore-icon-fill" d="M5.5 12a6.5 6.5 0 0 1 11.8-3.8l-3.8 2.3-4-2.2-3.8 2.4A6.2 6.2 0 0 0 5.5 12Z" />
          <path className="datastore-icon-accent-fill" d="M6 13.1c.5 3 3 5.4 6.2 5.4 2.1 0 3.8-1 5-2.4l-3.7-2.2-4 2z" />
          <path className="datastore-icon-stroke" d="m16.8 16.8 3 3" />
        </>
      )
    case 'search-wave':
      return (
        <>
          <circle className="datastore-icon-stroke" cx="10.5" cy="10.5" r="5.4" />
          <path className="datastore-icon-stroke" d="m14.6 14.6 4.4 4.4" />
          <path className="datastore-icon-accent-stroke" d="M6.8 11.4c1.7-2.4 5.7 2.4 7.4 0" />
        </>
      )
    case 'snowflake':
      return (
        <>
          <path className="datastore-icon-stroke-thick" d="M12 3.5v17M4.6 7.8l14.8 8.4M19.4 7.8 4.6 16.2" />
          <circle className="datastore-icon-accent-fill" cx="12" cy="12" r="2" />
        </>
      )
    case 'sql-cylinder':
      return databaseCylinder()
    case 'stacked-layers':
      return (
        <>
          <path className="datastore-icon-fill" d="m12 4 8 3.4-8 3.4-8-3.4z" />
          <path className="datastore-icon-accent-fill" d="m4 11 8 3.4 8-3.4v3l-8 3.4-8-3.4z" />
          <path className="datastore-icon-fill" d="m4 16 8 3.4 8-3.4v2.2l-8 3.4-8-3.4z" />
        </>
      )
    case 'waveform':
      return (
        <>
          <path className="datastore-icon-stroke-thick" d="M3.5 12h3l1.8-5.5L12 18l2.2-8 1.5 2h4.8" />
          <circle className="datastore-icon-accent-fill" cx="7.2" cy="12" r="1.2" />
          <circle className="datastore-icon-accent-fill" cx="16.8" cy="12" r="1.2" />
        </>
      )
  }
}

function databaseCylinder() {
  return (
    <>
      <ellipse className="datastore-icon-fill" cx="12" cy="6.5" rx="6.8" ry="3" />
      <path className="datastore-icon-fill" d="M5.2 6.5v10.2c0 1.7 3 3 6.8 3s6.8-1.3 6.8-3V6.5" />
      <path className="datastore-icon-background-stroke" d="M5.2 11.4c0 1.7 3 3 6.8 3s6.8-1.3 6.8-3M5.2 16.3c0 1.7 3 3 6.8 3s6.8-1.3 6.8-3" />
    </>
  )
}

function graphMark(withOrbit: boolean) {
  return (
    <>
      {withOrbit ? <ellipse className="datastore-icon-accent-stroke" cx="12" cy="12" rx="8" ry="4.4" transform="rotate(-25 12 12)" /> : null}
      <path className="datastore-icon-stroke" d="M8 8.2 15.8 6.7M8 8.2 6.8 15.8M15.8 6.7l1.5 8.7M6.8 15.8l10.5-.4" />
      <circle className="datastore-icon-fill" cx="8" cy="8.2" r="2.2" />
      <circle className="datastore-icon-accent-fill" cx="15.8" cy="6.7" r="2.2" />
      <circle className="datastore-icon-fill" cx="6.8" cy="15.8" r="2.2" />
      <circle className="datastore-icon-accent-fill" cx="17.3" cy="15.4" r="2.2" />
    </>
  )
}
