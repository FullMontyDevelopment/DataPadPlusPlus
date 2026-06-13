import { describe, expect, it } from 'vitest'
import {
  ADAPTER_CAPABILITIES,
  DATASTORE_ENGINES,
  DATASTORE_COMPLETENESS_CRITERIA,
  DATASTORE_COMPLETENESS_MATRIX,
  CONTRACT_COMPLETE_DATASTORE_ENGINES,
  NATIVE_COMPLETE_DATASTORE_ENGINES,
  DATASTORE_FAMILIES,
  DATASTORE_FEATURE_BACKLOG,
  BETA_ADAPTER_ENGINES,
  MVP_ADAPTER_ENGINES,
  PLANNED_ADAPTER_ENGINES,
  QUERY_LANGUAGES,
  RESULT_RENDERERS,
  datastoreBacklogByEngine,
  datastoreCompletenessForEngine,
  contractIncompleteCriteriaForEngine,
  incompleteCriteriaForEngine,
  isDatastoreContractComplete,
} from '@datapadplusplus/shared-types'
import { adapterManifests } from '../../../src/app/data/workspace-factory'

describe('datastore roadmap catalog', () => {
  it('publishes exactly one manifest for every declared datastore engine', () => {
    const manifestEngines = adapterManifests.map((manifest) => manifest.engine)

    expect(new Set(manifestEngines).size).toBe(manifestEngines.length)
    expect([...manifestEngines].sort()).toEqual([...DATASTORE_ENGINES].sort())
  })

  it('keeps manifests and backlog entries inside the shared type contracts', () => {
    const families = new Set(DATASTORE_FAMILIES)
    const capabilities = new Set(ADAPTER_CAPABILITIES)
    const languages = new Set(QUERY_LANGUAGES)
    const renderers = new Set(RESULT_RENDERERS)

    for (const manifest of adapterManifests) {
      expect(families.has(manifest.family)).toBe(true)
      expect(languages.has(manifest.defaultLanguage)).toBe(true)

      for (const capability of manifest.capabilities) {
        expect(capabilities.has(capability)).toBe(true)
      }
    }

    for (const entry of DATASTORE_FEATURE_BACKLOG) {
      expect(families.has(entry.family)).toBe(true)
      expect(entry.baselineFeatures.length).toBeGreaterThan(0)
      expect(entry.advancedFeatures.length).toBeGreaterThan(0)
      expect(entry.diagnosticFeatures.length).toBeGreaterThan(0)
      expect(entry.analyticsSignals.length).toBeGreaterThan(0)

      for (const language of entry.queryLanguages) {
        expect(languages.has(language)).toBe(true)
      }

      for (const renderer of entry.resultRenderers) {
        expect(renderers.has(renderer)).toBe(true)
      }
    }
  })

  it('separates executable MVP adapters from beta broad-market adapters', () => {
    expect(PLANNED_ADAPTER_ENGINES).toEqual([])

    for (const engine of MVP_ADAPTER_ENGINES) {
      expect(datastoreBacklogByEngine(engine)?.maturity).toBe('mvp')
      expect(
        adapterManifests.find((manifest) => manifest.engine === engine)
          ?.maturity,
      ).toBe('mvp')
    }

    for (const engine of BETA_ADAPTER_ENGINES) {
      expect(datastoreBacklogByEngine(engine)?.maturity).toBe('beta')
      expect(
        adapterManifests.find((manifest) => manifest.engine === engine)
          ?.maturity,
      ).toBe('beta')
    }

    for (const engine of PLANNED_ADAPTER_ENGINES) {
      expect(datastoreBacklogByEngine(engine)?.maturity).toBe('planned')
      expect(
        adapterManifests.find((manifest) => manifest.engine === engine)
          ?.maturity,
      ).toBe('planned')
    }
  })

  it('captures the requested market-expansion engines and diagnostic surfaces', () => {
    expect(datastoreBacklogByEngine('cockroachdb')).toMatchObject({
      family: 'sql',
      defaultLanguage: 'sql',
      defaultPort: 26257,
      maturity: 'mvp',
    })
    expect(datastoreBacklogByEngine('cockroachdb')?.connectionModes).toEqual(
      expect.arrayContaining(['native', 'connection-string', 'cloud-iam']),
    )
    expect(datastoreBacklogByEngine('elasticsearch')).toMatchObject({
      family: 'search',
      defaultLanguage: 'query-dsl',
    })
    expect(datastoreBacklogByEngine('opensearch')).toMatchObject({
      family: 'search',
      defaultLanguage: 'query-dsl',
    })
    expect(datastoreBacklogByEngine('clickhouse')).toMatchObject({
      family: 'warehouse',
      defaultLanguage: 'clickhouse-sql',
    })
    expect(datastoreBacklogByEngine('duckdb')).toMatchObject({
      family: 'embedded-olap',
      defaultLanguage: 'sql',
    })
    expect(datastoreBacklogByEngine('snowflake')).toMatchObject({
      family: 'warehouse',
      defaultLanguage: 'snowflake-sql',
    })
    expect(datastoreBacklogByEngine('bigquery')).toMatchObject({
      family: 'warehouse',
      defaultLanguage: 'google-sql',
    })
    expect(datastoreBacklogByEngine('oracle')).toMatchObject({
      family: 'sql',
      defaultLanguage: 'sql',
      defaultPort: 1521,
      maturity: 'beta',
    })
    expect(datastoreBacklogByEngine('litedb')).toMatchObject({
      family: 'document',
      defaultLanguage: 'json',
      maturity: 'beta',
      localDatabase: {
        defaultExtension: 'db',
        canCreateEmpty: true,
        canCreateStarter: false,
      },
    })
    expect(datastoreBacklogByEngine('duckdb')).toMatchObject({
      localDatabase: {
        defaultExtension: 'duckdb',
        canCreateEmpty: true,
        canCreateStarter: true,
      },
    })

    expect(datastoreBacklogByEngine('elasticsearch')?.capabilities).toContain(
      'supports_vector_search',
    )
    expect(datastoreBacklogByEngine('bigquery')?.capabilities).toEqual(
      expect.arrayContaining([
        'supports_cloud_iam',
        'supports_cost_estimation',
      ]),
    )
    expect(datastoreBacklogByEngine('snowflake')?.resultRenderers).toContain(
      'costEstimate',
    )
    expect(datastoreBacklogByEngine('oracle')?.capabilities).toEqual(
      expect.arrayContaining([
        'supports_permission_inspection',
        'supports_query_profile',
      ]),
    )
    expect(datastoreBacklogByEngine('litedb')?.capabilities).toEqual(
      expect.arrayContaining([
        'supports_document_view',
        'supports_index_management',
      ]),
    )
  })

  it('publishes a native-completeness matrix for every datastore engine', () => {
    const matrixEngines = DATASTORE_COMPLETENESS_MATRIX.map(
      (entry) => entry.engine,
    )

    expect(new Set(matrixEngines).size).toBe(matrixEngines.length)
    expect([...matrixEngines].sort()).toEqual([...DATASTORE_ENGINES].sort())

    for (const entry of DATASTORE_COMPLETENESS_MATRIX) {
      expect(entry.nativeScore).toBeGreaterThanOrEqual(0)
      expect(entry.nativeScore).toBeLessThanOrEqual(5)
      expect(entry.targetPhase).toBeGreaterThan(0)
      expect(
        entry.completionEvidence.length,
        `${entry.engine} completion evidence`,
      ).toBeGreaterThan(0)
      expect(
        entry.residualRisk.trim().length,
        `${entry.engine} residual risk`,
      ).toBeGreaterThan(20)
      expect(entry.summary.trim().length).toBeGreaterThan(20)
      expect(entry.criteria.map((criterion) => criterion.criterion)).toEqual([
        ...DATASTORE_COMPLETENESS_CRITERIA,
      ])
      for (const criterion of entry.criteria) {
        expect(
          criterion.note.trim().length,
          `${entry.engine}.${criterion.criterion} note`,
        ).toBeGreaterThan(20)
        expect(
          criterion.contractNote.trim().length,
          `${entry.engine}.${criterion.criterion} contract note`,
        ).toBeGreaterThan(20)
        expect(
          criterion.evidence.length,
          `${entry.engine}.${criterion.criterion} evidence`,
        ).toBeGreaterThan(0)
        expect(
          criterion.next.length,
          `${entry.engine}.${criterion.criterion} next steps`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('closes the all-engine contract-complete acceptance gate without hiding native gaps', () => {
    expect([...CONTRACT_COMPLETE_DATASTORE_ENGINES].sort()).toEqual(
      [...DATASTORE_ENGINES].sort(),
    )
    expect([...NATIVE_COMPLETE_DATASTORE_ENGINES]).toEqual([
      'mongodb',
      'postgresql',
      'sqlserver',
      'mysql',
      'mariadb',
      'cockroachdb',
      'timescaledb',
      'redis',
      'sqlite',
      'valkey',
      'oracle',
      'dynamodb',
      'elasticsearch',
      'opensearch',
      'duckdb',
    ])

    for (const engine of DATASTORE_ENGINES) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(isDatastoreContractComplete(engine), engine).toBe(true)
      expect(['contract-complete', 'native-complete'], engine).toContain(
        entry?.completionClaim,
      )
      expect(entry?.completionEvidence, engine).toContain('contract')
      expect(contractIncompleteCriteriaForEngine(engine), engine).toEqual([])
      expect(
        entry?.criteria.every(
          (criterion) => criterion.contractStatus === 'covered',
        ),
        engine,
      ).toBe(true)
    }

    expect(datastoreCompletenessForEngine('mongodb')?.residualRisk).toContain(
      'scoped native-complete claim',
    )
    expect(datastoreCompletenessForEngine('postgresql')?.residualRisk).toContain(
      'scoped native-complete claim',
    )
    expect(datastoreCompletenessForEngine('sqlserver')?.residualRisk).toContain(
      'scoped native-complete claim',
    )
    expect(datastoreCompletenessForEngine('mysql')?.residualRisk).toContain(
      'scoped native-complete claim',
    )
    expect(datastoreCompletenessForEngine('redis')?.residualRisk).toContain(
      'scoped native-complete claim',
    )
    expect(datastoreCompletenessForEngine('sqlite')?.residualRisk).toContain(
      'scoped native-complete claim',
    )
    expect(datastoreCompletenessForEngine('valkey')?.residualRisk).toContain(
      'scoped native-complete claim',
    )
    expect(datastoreCompletenessForEngine('oracle')?.residualRisk).toContain(
      'scoped native-complete claim',
    )
  })

  it('identifies MongoDB as a scoped native-complete reference target', () => {
    const mongo = datastoreCompletenessForEngine('mongodb')

    expect(mongo).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 1,
    })
    expect(
      mongo?.criteria.find((item) => item.criterion === 'object-views')?.status,
    ).toBe('strong')
    expect(
      mongo?.criteria.find((item) => item.criterion === 'safe-editing'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(incompleteCriteriaForEngine('mongodb')).toEqual([])
    expect(
      mongo?.criteria
        .find((item) => item.criterion === 'import-export')
        ?.next.join(' '),
    ).toContain('Optional extension')
    expect(mongo?.summary).toContain(
      'live guarded document insert/replace/delete',
    )
  })

  it('tracks Redis and Valkey native completion boundaries', () => {
    const redis = datastoreCompletenessForEngine('redis')
    const valkey = datastoreCompletenessForEngine('valkey')

    expect(redis).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
    })
    expect(valkey).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
    })
    expect(
      redis?.criteria.find((item) => item.criterion === 'intellisense'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      redis?.criteria.find((item) => item.criterion === 'object-views'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      redis?.criteria.find((item) => item.criterion === 'tests'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      redis?.criteria.find((item) => item.criterion === 'import-export'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      redis?.criteria
        .find((item) => item.criterion === 'tests')
        ?.next.join(' '),
    ).toContain('--require-vector')
    expect(redis?.summary).toContain('image-dependent optional extension')
    expect(
      valkey?.criteria.find((item) => item.criterion === 'import-export'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      valkey?.criteria
        .find((item) => item.criterion === 'tests')
        ?.next.join(' '),
    ).toContain('Optional extension')
  })

  it('identifies SQLite as a scoped native-complete local-file SQL target', () => {
    const sqlite = datastoreCompletenessForEngine('sqlite')

    expect(sqlite).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 2,
    })
    expect(incompleteCriteriaForEngine('sqlite')).toEqual([])
    expect(
      sqlite?.criteria.find((item) => item.criterion === 'import-export'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      sqlite?.criteria.find((item) => item.criterion === 'guarded-operations')
        ?.note,
    ).toContain('live desktop file workflows')
    expect(sqlite?.summary).toContain('VACUUM INTO backup')
  })

  it('tracks TimescaleDB and Oracle native-complete graduations', () => {
    const liveSqlEngines = [
      ['timescaledb', 5],
      ['oracle', 5],
    ] as const

    for (const [engine, nativeScore] of liveSqlEngines) {
      const entry = datastoreCompletenessForEngine(engine)
      const incompleteCriteria = incompleteCriteriaForEngine(engine).map(
        (item) => item.criterion,
      )

      expect(entry).toMatchObject({
        readiness: 'native',
        completionClaim: 'native-complete',
        nativeScore,
        targetPhase: 2,
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'safe-editing'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'tests'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'object-tree'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(incompleteCriteria).not.toContain('safe-editing')
      expect(incompleteCriteria).not.toContain('tests')
      expect(incompleteCriteria).toEqual([])
    }
  })

  it('identifies CockroachDB as a scoped native-complete SQL target', () => {
    const cockroach = datastoreCompletenessForEngine('cockroachdb')
    const incompleteCriteria = incompleteCriteriaForEngine('cockroachdb').map(
      (item) => item.criterion,
    )

    expect(cockroach).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 2,
    })
    for (const criterion of [
      'connection-flow',
      'object-tree',
      'query-surface',
      'intellisense',
      'object-views',
      'guarded-operations',
      'diagnostics-performance',
      'import-export',
      'safe-editing',
      'tests',
    ] as const) {
      expect(
        cockroach?.criteria.find((item) => item.criterion === criterion),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
    }
    expect(incompleteCriteria).toEqual([])
    expect(cockroach?.summary).toContain('connection/profile metadata')
    expect(cockroach?.summary).toContain('capability gates')
    expect(cockroach?.summary).toContain('crdb_internal diagnostics')
    expect(cockroach?.summary).toContain('preview-first IMPORT, EXPORT, BACKUP, RESTORE')
    expect(cockroach?.summary).toContain('outside this scoped claim')
  })

  it('identifies MariaDB as a scoped native-complete SQL target', () => {
    const mariadb = datastoreCompletenessForEngine('mariadb')
    const incompleteCriteria = incompleteCriteriaForEngine('mariadb').map(
      (item) => item.criterion,
    )

    expect(mariadb).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 2,
    })
    expect(incompleteCriteria).toEqual([])
    expect(
      mariadb?.criteria.find((item) => item.criterion === 'connection-flow'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mariadb?.criteria.find((item) => item.criterion === 'object-tree'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mariadb?.criteria.find((item) => item.criterion === 'object-views'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mariadb?.criteria.find((item) => item.criterion === 'query-surface'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mariadb?.criteria.find((item) => item.criterion === 'intellisense'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mariadb?.criteria.find((item) => item.criterion === 'diagnostics-performance'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mariadb?.criteria.find((item) => item.criterion === 'guarded-operations'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mariadb?.criteria.find((item) => item.criterion === 'import-export'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(mariadb?.summary).toContain('ANALYZE FORMAT=JSON')
    expect(mariadb?.summary).toContain('typed MariaDB connection/profile metadata')
    expect(mariadb?.summary).toContain('MariaDB-aware Workbench-style trees')
    expect(mariadb?.summary).toContain('native MariaDB object-view descriptors')
    expect(mariadb?.summary).toContain('guarded desktop CSV/JSON/NDJSON table import/export')
    expect(mariadb?.summary).toContain('role-mapping security previews')
  })

  it('identifies MySQL as a scoped native-complete SQL target', () => {
    const mysql = datastoreCompletenessForEngine('mysql')
    const incompleteCriteria = incompleteCriteriaForEngine('mysql').map(
      (item) => item.criterion,
    )

    expect(mysql).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 2,
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'connection-flow'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'connection-flow')
        ?.note,
    ).toContain('typed native connection/profile options')
    expect(
      mysql?.criteria.find((item) => item.criterion === 'object-tree'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'object-tree')?.note,
    ).toContain('Workbench-style live tree branches')
    expect(
      mysql?.criteria.find((item) => item.criterion === 'query-surface'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'query-surface')
        ?.note,
    ).toContain('MySQL-native query-helper snippets')
    expect(
      mysql?.criteria.find((item) => item.criterion === 'intellisense'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'intellisense')?.note,
    ).toContain('backtick-aware alias completions')
    expect(
      mysql?.criteria.find((item) => item.criterion === 'object-views'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'object-views')?.note,
    ).toContain('statement digest')
    expect(
      mysql?.criteria.find((item) => item.criterion === 'diagnostics-performance'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'diagnostics-performance')
        ?.note,
    ).toContain('performance_schema')
    expect(
      mysql?.criteria.find((item) => item.criterion === 'import-export'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'import-export')?.note,
    ).toContain('guarded desktop CSV/JSON/NDJSON table export/import')
    expect(
      mysql?.criteria.find((item) => item.criterion === 'guarded-operations'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      mysql?.criteria.find((item) => item.criterion === 'guarded-operations')
        ?.note,
    ).toContain('structured browser/Rust workflow contracts')
    expect(incompleteCriteria).not.toContain('connection-flow')
    expect(incompleteCriteria).not.toContain('object-tree')
    expect(incompleteCriteria).not.toContain('query-surface')
    expect(incompleteCriteria).not.toContain('intellisense')
    expect(incompleteCriteria).not.toContain('object-views')
    expect(incompleteCriteria).not.toContain('import-export')
    expect(incompleteCriteria).not.toContain('guarded-operations')
    expect(incompleteCriteria).toEqual([])
    expect(mysql?.summary).toContain('typed native connection/profile options')
    expect(mysql?.summary).toContain('MySQL-native IntelliSense/query-helper snippets')
    expect(mysql?.summary).toContain('native storage/index/security/session/status')
    expect(mysql?.summary).toContain('live performance_schema/status/optimizer diagnostics')
    expect(mysql?.summary).toContain('structured guarded maintenance/routine/event/security/user previews')
    expect(mysql?.summary).toContain('bounded JSON/SQL logical backup packages')
  })

  it('identifies PostgreSQL as a scoped native-complete SQL target', () => {
    const postgres = datastoreCompletenessForEngine('postgresql')
    const incompleteCriteria = incompleteCriteriaForEngine('postgresql').map(
      (item) => item.criterion,
    )

    expect(postgres).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 2,
    })
    expect(
      postgres?.criteria.find((item) => item.criterion === 'connection-flow'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      postgres?.criteria.find((item) => item.criterion === 'connection-flow')
        ?.note,
    ).toContain('typed TCP')
    expect(
      postgres?.criteria.find((item) => item.criterion === 'object-tree'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      postgres?.criteria.find((item) => item.criterion === 'object-views'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      postgres?.criteria.find(
        (item) => item.criterion === 'guarded-operations',
      ),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      postgres?.criteria.find((item) => item.criterion === 'safe-editing')
        ?.note,
    ).toContain('before/after row evidence')
    expect(
      postgres?.criteria.find(
        (item) => item.criterion === 'diagnostics-performance',
      ),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      postgres?.criteria.find((item) => item.criterion === 'intellisense'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      postgres?.criteria.find((item) => item.criterion === 'query-surface'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      postgres?.criteria.find(
        (item) => item.criterion === 'diagnostics-performance',
      )?.note,
    ).toContain('pg_stat_activity')
    expect(postgres?.summary).toContain(
      'rendered EXPLAIN ANALYZE JSON profile dashboards',
    )
    expect(postgres?.summary).toContain('typed native connection/profile options')
    expect(postgres?.summary).toContain('PostgreSQL-aware IntelliSense')
    expect(postgres?.summary).toContain(
      'role membership/default privilege/grant views',
    )
    expect(postgres?.summary).toContain('extension update/drop plans')
    expect(postgres?.summary).toContain('before/after row evidence metadata')
    expect(postgres?.summary).toContain('guarded parameterized routine execution plans')
    expect(postgres?.summary).toContain('pg_cancel_backend/pg_terminate_backend previews')
    expect(postgres?.summary).toContain('optional PostgreSQL fixture validation')
    expect(postgres?.summary).toContain('Full pg_dump/pg_restore execution')
    expect(postgres?.summary).toContain(
      'guarded desktop CSV/JSON/NDJSON table export/import',
    )
    expect(
      postgres?.criteria.find((item) => item.criterion === 'import-export'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      postgres?.criteria.find((item) => item.criterion === 'import-export')
        ?.note,
    ).toContain('bounded JSON/SQL logical backup packages')
    expect(incompleteCriteria).not.toContain('object-tree')
    expect(incompleteCriteria).not.toContain('connection-flow')
    expect(incompleteCriteria).not.toContain('object-views')
    expect(incompleteCriteria).not.toContain('guarded-operations')
    expect(incompleteCriteria).not.toContain('diagnostics-performance')
    expect(incompleteCriteria).not.toContain('import-export')
    expect(incompleteCriteria).not.toContain('intellisense')
    expect(incompleteCriteria).not.toContain('query-surface')
  })

  it('identifies SQL Server as a scoped native-complete SQL target', () => {
    const sqlserver = datastoreCompletenessForEngine('sqlserver')
    const incompleteCriteria = incompleteCriteriaForEngine('sqlserver').map(
      (item) => item.criterion,
    )

    expect(sqlserver).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 2,
    })
    expect(incompleteCriteria).toEqual([])
    expect(
      sqlserver?.criteria.find((item) => item.criterion === 'connection-flow'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      sqlserver?.criteria.find((item) => item.criterion === 'object-views'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      sqlserver?.criteria.find(
        (item) => item.criterion === 'diagnostics-performance',
      )?.note,
    ).toContain('runtime DMV payloads')
    expect(
      sqlserver?.criteria.find((item) => item.criterion === 'import-export'),
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      sqlserver?.criteria.find((item) => item.criterion === 'import-export')
        ?.note,
    ).toContain('bounded JSON/SQL logical backup package')
    expect(sqlserver?.summary).toContain(
      'Native-complete for the scoped SQL Server/Azure SQL workflow',
    )
    expect(sqlserver?.summary).toContain('guarded desktop CSV/JSON/NDJSON')
    expect(sqlserver?.summary).toContain('Native .bak BACKUP/RESTORE')
  })

  it('graduates Elasticsearch and OpenSearch as scoped plain-HTTP search workflows', () => {
    const elasticsearch = datastoreCompletenessForEngine('elasticsearch')
    expect(elasticsearch).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 3,
    })
    expect(elasticsearch?.summary).toContain(
      'Native-complete for the scoped Elasticsearch plain-HTTP search workflow',
    )
    expect(elasticsearch?.summary).toContain('optional search fixture validator')
    expect(elasticsearch?.summary).toContain('desktop file/cloud import-export')
    expect(incompleteCriteriaForEngine('elasticsearch')).toEqual([])

    const opensearch = datastoreCompletenessForEngine('opensearch')
    expect(opensearch).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 3,
    })
    expect(opensearch?.summary).toContain(
      'Native-complete for the scoped OpenSearch plain-HTTP search workflow',
    )
    expect(opensearch?.summary).toContain('optional search fixture validator')
    expect(opensearch?.summary).toContain(
      'OpenSearch SQL, ISM, security, and Performance Analyzer boundary evidence',
    )
    expect(opensearch?.summary).toContain('Managed SigV4/IAM runtime execution')
    expect(opensearch?.summary).toContain('Performance Analyzer')
    expect(incompleteCriteriaForEngine('opensearch')).toEqual([])

    const dynamodb = datastoreCompletenessForEngine('dynamodb')
    expect(dynamodb).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 3,
    })
    expect(dynamodb?.summary).toContain(
      'Native-complete for the scoped DynamoDB',
    )
    expect(incompleteCriteriaForEngine('dynamodb')).toEqual([])

    const cassandra = datastoreCompletenessForEngine('cassandra')

    expect(cassandra).toMatchObject({
      readiness: 'foundation',
      completionClaim: 'contract-complete',
      nativeScore: 3.05,
      targetPhase: 3,
    })
    expect(
      cassandra?.criteria.find((item) => item.criterion === 'safe-editing')
        ?.status,
    ).toBe('partial')
    expect(
      incompleteCriteriaForEngine('cassandra').map((item) => item.criterion),
    ).toContain('safe-editing')
  })

  it('tracks Wave 9 Wave 4 query and test hardening without promoting live mutations', () => {
    const documentAndCacheEngines = [
      ['cosmosdb', 3.2],
      ['litedb', 4.65],
      ['memcached', 3.25],
    ] as const

    for (const [engine, nativeScore] of documentAndCacheEngines) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(entry).toMatchObject({
        readiness: 'foundation',
        completionClaim: 'contract-complete',
        nativeScore,
        targetPhase: 4,
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'tests'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'safe-editing')
          ?.status,
      ).toBe('partial')
    }

    const analyticsEngines = [
      ['clickhouse', 3.45, 'foundation'],
      ['snowflake', 3.4, 'foundation'],
      ['bigquery', 3.4, 'foundation'],
    ] as const

    for (const [engine, nativeScore, readiness] of analyticsEngines) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(entry).toMatchObject({
        readiness,
        completionClaim: 'contract-complete',
        nativeScore,
        targetPhase: 4,
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'query-surface'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'tests'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'safe-editing')
          ?.status,
      ).toBe('partial')
    }

    const duckdb = datastoreCompletenessForEngine('duckdb')
    expect(duckdb).toMatchObject({
      readiness: 'native',
      completionClaim: 'native-complete',
      nativeScore: 5,
      targetPhase: 4,
    })
    expect(incompleteCriteriaForEngine('duckdb')).toEqual([])
    expect(duckdb?.summary).toContain(
      'native-complete for the scoped local-file analytics workflow',
    )
    expect(duckdb?.summary).toContain(
      'optional DuckDB fixture validator evidence',
    )
    expect(duckdb?.summary).toContain(
      'bundled local-file read/EXPLAIN/profile',
    )
    expect(duckdb?.summary).toContain(
      'guarded live CSV export, CSV import, CSV backup-folder',
    )
    expect(duckdb?.summary).toContain(
      'database file access/read-only preflight',
    )
    expect(duckdb?.summary).toContain(
      'explicit scoped file-workflow lock-boundary metadata',
    )
    expect(duckdb?.summary).toContain(
      'JSON/Parquet extension-backed format preflight',
    )
    expect(duckdb?.summary).toContain(
      'explicit preloaded-extension-only JSON/Parquet boundaries',
    )
    expect(duckdb?.summary).toContain(
      'restore-package preflight',
    )
    expect(duckdb?.summary).toContain(
      'explicit restore execution-boundary evidence',
    )
    expect(duckdb?.summary).toContain(
      'structured extension install/load gates',
    )
    expect(duckdb?.summary).toContain(
      'structured analyze/checkpoint/object admin-scope gates',
    )
    expect(duckdb?.summary).toContain(
      'explicit admin/extension execution-boundary evidence',
    )
    expect(
      duckdb?.criteria.find((item) => item.criterion === 'query-surface')
        ?.note,
    ).toContain('bundled local-file read SQL execution')
    expect(
      duckdb?.criteria.find(
        (item) => item.criterion === 'diagnostics-performance',
      )?.note,
    ).toContain('read_csv/read_parquet/read_json query templates')
    expect(
      duckdb?.criteria.find((item) => item.criterion === 'safe-editing')
    ).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(
      duckdb?.criteria.find((item) => item.criterion === 'safe-editing')
        ?.note,
    ).toContain('explicit scoped exclusions')
    expect(
      duckdb?.criteria.find((item) => item.criterion === 'safe-editing')
        ?.next.join(' '),
    ).toContain('cross-process lock')
    expect(
      duckdb?.criteria.find((item) => item.criterion === 'import-export')
        ?.note,
    ).toContain('restore-package preflight')
  })

  it('tracks Wave 10 time-series and graph query hardening without promoting writes', () => {
    const waveTenEngines = [
      ['prometheus', 3.3],
      ['influxdb', 3.35],
      ['opentsdb', 3.2],
      ['neo4j', 3.4],
      ['arango', 3.3],
      ['janusgraph', 3.2],
      ['neptune', 3.25],
    ] as const

    for (const [engine, nativeScore] of waveTenEngines) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(entry).toMatchObject({
        readiness: 'foundation',
        completionClaim: 'contract-complete',
        nativeScore,
        targetPhase: 5,
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'query-surface'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'tests'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'safe-editing')
          ?.status,
      ).toBe('partial')
    }
  })

  it('tracks Wave 11 deterministic intellisense hardening without live metadata claims', () => {
    const engines = [
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'clickhouse',
      'snowflake',
      'bigquery',
      'prometheus',
      'influxdb',
      'opentsdb',
      'neo4j',
      'arango',
      'janusgraph',
      'neptune',
    ] as const

    for (const engine of engines) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(
        entry?.criteria.find((item) => item.criterion === 'intellisense'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria
          .find((item) => item.criterion === 'intellisense')
          ?.next.join(' '),
        engine,
      ).toContain('live')
    }
  })

  it('tracks Wave 12 secondary object-tree parity without live capability claims', () => {
    const engines = [
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'clickhouse',
      'snowflake',
      'bigquery',
      'prometheus',
      'influxdb',
      'opentsdb',
      'neo4j',
      'arango',
      'janusgraph',
      'neptune',
    ] as const

    for (const engine of engines) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(
        entry?.criteria.find((item) => item.criterion === 'object-tree'),
      ).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'object-tree')?.note,
        engine,
      ).toMatch(/shared\/Rust tree manifests|browser explorer routing/)
      expect(
        entry?.criteria
          .find((item) => item.criterion === 'object-tree')
          ?.next.join(' '),
        engine,
      ).toContain('live')
    }
  })

  it('tracks Wave 13 secondary connection-flow parity without live driver claims', () => {
    const engines = [
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'clickhouse',
      'snowflake',
      'bigquery',
      'prometheus',
      'influxdb',
      'opentsdb',
      'neo4j',
      'arango',
      'janusgraph',
      'neptune',
    ] as const

    for (const engine of engines) {
      const entry = datastoreCompletenessForEngine(engine)
      const connectionFlow = entry?.criteria.find(
        (item) => item.criterion === 'connection-flow',
      )

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/connection-flow parity/)
      expect(connectionFlow, engine).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(connectionFlow?.note, engine).toMatch(
        /right-drawer fields|Rust interpolation/,
      )
      expect(connectionFlow?.next.join(' '), engine).toContain('live')
    }
  })

  it('tracks Wave 14 secondary guarded-operation parity without live admin claims', () => {
    const engines = [
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'clickhouse',
      'snowflake',
      'bigquery',
      'prometheus',
      'influxdb',
      'opentsdb',
      'neo4j',
      'arango',
      'janusgraph',
      'neptune',
    ] as const

    for (const engine of engines) {
      const entry = datastoreCompletenessForEngine(engine)
      const guardedOperations = entry?.criteria.find(
        (item) => item.criterion === 'guarded-operations',
      )

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/guarded operation parity/)
      expect(guardedOperations, engine).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(guardedOperations?.note, engine).toMatch(
        /browser planners|Rust planners/,
      )
      expect(guardedOperations?.next.join(' '), engine).toContain('live')
    }
  })

  it('tracks Wave 15 secondary diagnostics-performance parity without live sampling claims', () => {
    const engines = [
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'clickhouse',
      'snowflake',
      'bigquery',
      'prometheus',
      'influxdb',
      'opentsdb',
      'neo4j',
      'arango',
      'janusgraph',
      'neptune',
    ] as const

    for (const engine of engines) {
      const entry = datastoreCompletenessForEngine(engine)
      const diagnostics = entry?.criteria.find(
        (item) => item.criterion === 'diagnostics-performance',
      )

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/diagnostics\/performance parity/)
      expect(diagnostics, engine).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(diagnostics?.note, engine).toMatch(
        /object-view posture panels|Rust metrics\/profile/,
      )
      expect(diagnostics?.next.join(' '), engine).toContain('live')
    }
  })

  it('tracks Wave 16 secondary import-export parity without live file execution claims', () => {
    const engines = [
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'clickhouse',
      'snowflake',
      'bigquery',
      'prometheus',
      'influxdb',
      'opentsdb',
      'neo4j',
      'arango',
      'janusgraph',
      'neptune',
    ] as const

    for (const engine of engines) {
      const entry = datastoreCompletenessForEngine(engine)
      const importExport = entry?.criteria.find(
        (item) => item.criterion === 'import-export',
      )

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/import\/export parity/)
      expect(importExport, engine).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(importExport?.note, engine).toMatch(
        /browser planners|Rust planners|bounded range export/,
      )
      expect(importExport?.next.join(' '), engine).toMatch(
        /live|adapter-owned|fixture/,
      )
    }
  })

  it('tracks Wave 17 secondary object-view parity without live payload-depth claims', () => {
    const engines = [
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'clickhouse',
      'snowflake',
      'bigquery',
      'prometheus',
      'influxdb',
      'opentsdb',
      'neo4j',
      'arango',
      'janusgraph',
      'neptune',
    ] as const

    for (const engine of engines) {
      const entry = datastoreCompletenessForEngine(engine)
      const objectViews = entry?.criteria.find(
        (item) => item.criterion === 'object-views',
      )

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/object-view parity/)
      expect(objectViews, engine).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(objectViews?.note, engine).toMatch(
        /descriptor-backed workflows|focused descriptor tests/,
      )
      expect(objectViews?.next.join(' '), engine).toMatch(
        /live|fixture|validation/,
      )
    }
  })

  it('promotes Wave 4 engines into contract-complete foundation profiles', () => {
    const waveFourEngines = [
      'cosmosdb',
      'litedb',
      'memcached',
      'clickhouse',
      'snowflake',
      'bigquery',
    ] as const

    for (const engine of waveFourEngines) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(entry?.targetPhase, engine).toBe(4)
      expect(entry?.readiness, engine).toMatch(/foundation|usable/)
      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/contract-complete/)
      expect(
        entry?.criteria.find((item) => item.criterion === 'guarded-operations')
          ?.status,
      ).toBe('strong')
    }
  })

  it('promotes Wave 5 engines into contract-complete foundation profiles', () => {
    const waveFiveEngines = [
      'prometheus',
      'influxdb',
      'opentsdb',
      'neo4j',
      'arango',
      'janusgraph',
      'neptune',
    ] as const

    for (const engine of waveFiveEngines) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(entry?.targetPhase, engine).toBe(5)
      expect(entry?.readiness, engine).toBe('foundation')
      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/contract-complete/)
      expect(
        entry?.criteria.find((item) => item.criterion === 'guarded-operations')
          ?.status,
      ).toBe('strong')
    }
  })
})
