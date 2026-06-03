import { describe, expect, it } from 'vitest'
import {
  ADAPTER_CAPABILITIES,
  DATASTORE_ENGINES,
  DATASTORE_COMPLETENESS_CRITERIA,
  DATASTORE_COMPLETENESS_MATRIX,
  CONTRACT_COMPLETE_DATASTORE_ENGINES,
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
import { adapterManifests } from './workspace-factory'

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
      expect(adapterManifests.find((manifest) => manifest.engine === engine)?.maturity).toBe(
        'mvp',
      )
    }

    for (const engine of BETA_ADAPTER_ENGINES) {
      expect(datastoreBacklogByEngine(engine)?.maturity).toBe('beta')
      expect(adapterManifests.find((manifest) => manifest.engine === engine)?.maturity).toBe(
        'beta',
      )
    }

    for (const engine of PLANNED_ADAPTER_ENGINES) {
      expect(datastoreBacklogByEngine(engine)?.maturity).toBe('planned')
      expect(adapterManifests.find((manifest) => manifest.engine === engine)?.maturity).toBe(
        'planned',
      )
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
      expect.arrayContaining(['supports_cloud_iam', 'supports_cost_estimation']),
    )
    expect(datastoreBacklogByEngine('snowflake')?.resultRenderers).toContain(
      'costEstimate',
    )
    expect(datastoreBacklogByEngine('oracle')?.capabilities).toEqual(
      expect.arrayContaining(['supports_permission_inspection', 'supports_query_profile']),
    )
    expect(datastoreBacklogByEngine('litedb')?.capabilities).toEqual(
      expect.arrayContaining(['supports_document_view', 'supports_index_management']),
    )
  })

  it('publishes a native-completeness matrix for every datastore engine', () => {
    const matrixEngines = DATASTORE_COMPLETENESS_MATRIX.map((entry) => entry.engine)

    expect(new Set(matrixEngines).size).toBe(matrixEngines.length)
    expect([...matrixEngines].sort()).toEqual([...DATASTORE_ENGINES].sort())

    for (const entry of DATASTORE_COMPLETENESS_MATRIX) {
      expect(entry.nativeScore).toBeGreaterThanOrEqual(0)
      expect(entry.nativeScore).toBeLessThanOrEqual(5)
      expect(entry.targetPhase).toBeGreaterThan(0)
      expect(entry.completionEvidence.length, `${entry.engine} completion evidence`).toBeGreaterThan(0)
      expect(entry.residualRisk.trim().length, `${entry.engine} residual risk`).toBeGreaterThan(20)
      expect(entry.summary.trim().length).toBeGreaterThan(20)
      expect(entry.criteria.map((criterion) => criterion.criterion)).toEqual([
        ...DATASTORE_COMPLETENESS_CRITERIA,
      ])
      for (const criterion of entry.criteria) {
        expect(criterion.note.trim().length, `${entry.engine}.${criterion.criterion} note`).toBeGreaterThan(20)
        expect(criterion.contractNote.trim().length, `${entry.engine}.${criterion.criterion} contract note`).toBeGreaterThan(20)
        expect(criterion.evidence.length, `${entry.engine}.${criterion.criterion} evidence`).toBeGreaterThan(0)
        expect(criterion.next.length, `${entry.engine}.${criterion.criterion} next steps`).toBeGreaterThan(0)
      }
    }
  })

  it('closes the all-engine contract-complete acceptance gate without hiding native gaps', () => {
    expect([...CONTRACT_COMPLETE_DATASTORE_ENGINES].sort()).toEqual([...DATASTORE_ENGINES].sort())

    for (const engine of DATASTORE_ENGINES) {
      const entry = datastoreCompletenessForEngine(engine)

      expect(isDatastoreContractComplete(engine), engine).toBe(true)
      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.completionEvidence, engine).toContain('contract')
      expect(contractIncompleteCriteriaForEngine(engine), engine).toEqual([])
      expect(entry?.criteria.every((criterion) => criterion.contractStatus === 'covered'), engine).toBe(
        true,
      )
    }

    expect(incompleteCriteriaForEngine('mongodb').length).toBeGreaterThan(0)
  })

  it('identifies MongoDB as the first near-native reference target without hiding remaining gaps', () => {
    const mongo = datastoreCompletenessForEngine('mongodb')

    expect(mongo).toMatchObject({
      readiness: 'near-native',
      completionClaim: 'contract-complete',
      nativeScore: 4.15,
      targetPhase: 1,
    })
    expect(mongo?.criteria.find((item) => item.criterion === 'object-views')?.status).toBe(
      'strong',
    )
    expect(mongo?.criteria.find((item) => item.criterion === 'safe-editing')).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(incompleteCriteriaForEngine('mongodb').map((item) => item.criterion)).toEqual(
      expect.arrayContaining(['diagnostics-performance', 'import-export']),
    )
    expect(incompleteCriteriaForEngine('mongodb').map((item) => item.criterion)).not.toContain(
      'safe-editing',
    )
  })

  it('tracks Wave 6 reference-engine hardening without declaring native completion', () => {
    const redis = datastoreCompletenessForEngine('redis')
    const valkey = datastoreCompletenessForEngine('valkey')

    expect(redis).toMatchObject({
      readiness: 'near-native',
      completionClaim: 'contract-complete',
      nativeScore: 3.8,
    })
    expect(valkey).toMatchObject({
      readiness: 'usable',
      completionClaim: 'contract-complete',
      nativeScore: 3.35,
    })
    expect(redis?.criteria.find((item) => item.criterion === 'tests')).toMatchObject({
      status: 'strong',
      contractStatus: 'covered',
    })
    expect(redis?.criteria.find((item) => item.criterion === 'import-export')?.status).toBe(
      'partial',
    )
    expect(valkey?.criteria.find((item) => item.criterion === 'import-export')?.status).toBe(
      'partial',
    )
  })

  it('tracks Wave 7 core SQL row-edit hardening without promoting Oracle live execution', () => {
    const liveSqlEngines = [
      ['postgresql', 3.35],
      ['cockroachdb', 3.15],
      ['sqlserver', 3.35],
      ['mysql', 3.05],
      ['mariadb', 3.05],
      ['sqlite', 3.2],
      ['timescaledb', 3.2],
    ] as const

    for (const [engine, nativeScore] of liveSqlEngines) {
      const entry = datastoreCompletenessForEngine(engine)
      const incompleteCriteria = incompleteCriteriaForEngine(engine).map((item) => item.criterion)

      expect(entry).toMatchObject({
        readiness: 'usable',
        completionClaim: 'contract-complete',
        nativeScore,
        targetPhase: 2,
      })
      expect(entry?.criteria.find((item) => item.criterion === 'safe-editing')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(entry?.criteria.find((item) => item.criterion === 'tests')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(incompleteCriteria).not.toContain('safe-editing')
      expect(incompleteCriteria).not.toContain('tests')
    }

    const oracle = datastoreCompletenessForEngine('oracle')

    expect(oracle).toMatchObject({
      readiness: 'foundation',
      completionClaim: 'contract-complete',
      nativeScore: 2.75,
      targetPhase: 2,
    })
    expect(oracle?.criteria.find((item) => item.criterion === 'safe-editing')?.status).toBe(
      'partial',
    )
    expect(incompleteCriteriaForEngine('oracle').map((item) => item.criterion)).toContain(
      'safe-editing',
    )
  })

  it('tracks Wave 8 search and DynamoDB edit hardening without promoting Cassandra live execution', () => {
    const promotedEngines = [
      ['elasticsearch', 3.55],
      ['opensearch', 3.45],
      ['dynamodb', 3.5],
    ] as const

    for (const [engine, nativeScore] of promotedEngines) {
      const entry = datastoreCompletenessForEngine(engine)
      const incompleteCriteria = incompleteCriteriaForEngine(engine).map((item) => item.criterion)

      expect(entry).toMatchObject({
        readiness: 'foundation',
        completionClaim: 'contract-complete',
        nativeScore,
        targetPhase: 3,
      })
      expect(entry?.criteria.find((item) => item.criterion === 'safe-editing')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(entry?.criteria.find((item) => item.criterion === 'tests')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(incompleteCriteria).not.toContain('safe-editing')
      expect(incompleteCriteria).not.toContain('tests')
    }

    const cassandra = datastoreCompletenessForEngine('cassandra')

    expect(cassandra).toMatchObject({
      readiness: 'foundation',
      completionClaim: 'contract-complete',
      nativeScore: 3.05,
      targetPhase: 3,
    })
    expect(cassandra?.criteria.find((item) => item.criterion === 'safe-editing')?.status).toBe(
      'partial',
    )
    expect(incompleteCriteriaForEngine('cassandra').map((item) => item.criterion)).toContain(
      'safe-editing',
    )
  })

  it('tracks Wave 9 Wave 4 query and test hardening without promoting live mutations', () => {
    const documentAndCacheEngines = [
      ['cosmosdb', 3.2],
      ['litedb', 3.3],
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
      expect(entry?.criteria.find((item) => item.criterion === 'tests')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(entry?.criteria.find((item) => item.criterion === 'safe-editing')?.status).toBe(
        'partial',
      )
    }

    const analyticsEngines = [
      ['duckdb', 3.7, 'usable'],
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
      expect(entry?.criteria.find((item) => item.criterion === 'query-surface')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(entry?.criteria.find((item) => item.criterion === 'tests')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(entry?.criteria.find((item) => item.criterion === 'safe-editing')?.status).toBe(
        'partial',
      )
    }
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
      expect(entry?.criteria.find((item) => item.criterion === 'query-surface')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(entry?.criteria.find((item) => item.criterion === 'tests')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(entry?.criteria.find((item) => item.criterion === 'safe-editing')?.status).toBe(
        'partial',
      )
    }
  })

  it('tracks Wave 11 deterministic intellisense hardening without live metadata claims', () => {
    const engines = [
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'duckdb',
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
      expect(entry?.criteria.find((item) => item.criterion === 'intellisense')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'intellisense')?.next.join(' '),
        engine,
      ).toContain('live')
    }
  })

  it('tracks Wave 12 secondary object-tree parity without live capability claims', () => {
    const engines = [
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'duckdb',
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
      expect(entry?.criteria.find((item) => item.criterion === 'object-tree')).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(
        entry?.criteria.find((item) => item.criterion === 'object-tree')?.note,
        engine,
      ).toMatch(/shared\/Rust tree manifests|browser explorer routing/)
      expect(
        entry?.criteria.find((item) => item.criterion === 'object-tree')?.next.join(' '),
        engine,
      ).toContain('live')
    }
  })

  it('tracks Wave 13 secondary connection-flow parity without live driver claims', () => {
    const engines = [
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'duckdb',
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
      const connectionFlow = entry?.criteria.find((item) => item.criterion === 'connection-flow')

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/connection-flow parity/)
      expect(connectionFlow, engine).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(connectionFlow?.note, engine).toMatch(/right-drawer fields|Rust interpolation/)
      expect(connectionFlow?.next.join(' '), engine).toContain('live')
    }
  })

  it('tracks Wave 14 secondary guarded-operation parity without live admin claims', () => {
    const engines = [
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'duckdb',
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
      expect(guardedOperations?.note, engine).toMatch(/browser planners|Rust planners/)
      expect(guardedOperations?.next.join(' '), engine).toContain('live')
    }
  })

  it('tracks Wave 15 secondary diagnostics-performance parity without live sampling claims', () => {
    const engines = [
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'duckdb',
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
      expect(diagnostics?.note, engine).toMatch(/object-view posture panels|Rust metrics\/profile/)
      expect(diagnostics?.next.join(' '), engine).toContain('live')
    }
  })

  it('tracks Wave 16 secondary import-export parity without live file execution claims', () => {
    const engines = [
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'duckdb',
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
      const importExport = entry?.criteria.find((item) => item.criterion === 'import-export')

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/import\/export parity/)
      expect(importExport, engine).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(importExport?.note, engine).toMatch(/browser planners|Rust planners|bounded range export/)
      expect(importExport?.next.join(' '), engine).toMatch(/live|adapter-owned|fixture/)
    }
  })

  it('tracks Wave 17 secondary object-view parity without live payload-depth claims', () => {
    const engines = [
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'cassandra',
      'cosmosdb',
      'litedb',
      'memcached',
      'duckdb',
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
      const objectViews = entry?.criteria.find((item) => item.criterion === 'object-views')

      expect(entry?.completionClaim, engine).toBe('contract-complete')
      expect(entry?.summary, engine).toMatch(/object-view parity/)
      expect(objectViews, engine).toMatchObject({
        status: 'strong',
        contractStatus: 'covered',
      })
      expect(objectViews?.note, engine).toMatch(/descriptor-backed workflows|focused descriptor tests/)
      expect(objectViews?.next.join(' '), engine).toMatch(/live|fixture|validation/)
    }
  })

  it('promotes Wave 4 engines into contract-complete foundation profiles', () => {
    const waveFourEngines = [
      'cosmosdb',
      'litedb',
      'memcached',
      'duckdb',
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
      expect(entry?.criteria.find((item) => item.criterion === 'guarded-operations')?.status).toBe(
        'strong',
      )
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
      expect(entry?.criteria.find((item) => item.criterion === 'guarded-operations')?.status).toBe(
        'strong',
      )
    }
  })
})
