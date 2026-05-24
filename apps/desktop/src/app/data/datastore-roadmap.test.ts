import { describe, expect, it } from 'vitest'
import {
  ADAPTER_CAPABILITIES,
  DATASTORE_ENGINES,
  DATASTORE_COMPLETENESS_CRITERIA,
  DATASTORE_COMPLETENESS_MATRIX,
  DATASTORE_FAMILIES,
  DATASTORE_FEATURE_BACKLOG,
  BETA_ADAPTER_ENGINES,
  MVP_ADAPTER_ENGINES,
  PLANNED_ADAPTER_ENGINES,
  QUERY_LANGUAGES,
  RESULT_RENDERERS,
  datastoreBacklogByEngine,
  datastoreCompletenessForEngine,
  incompleteCriteriaForEngine,
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
      expect(entry.summary.trim().length).toBeGreaterThan(20)
      expect(entry.criteria.map((criterion) => criterion.criterion)).toEqual([
        ...DATASTORE_COMPLETENESS_CRITERIA,
      ])
      for (const criterion of entry.criteria) {
        expect(criterion.note.trim().length, `${entry.engine}.${criterion.criterion} note`).toBeGreaterThan(20)
        expect(criterion.next.length, `${entry.engine}.${criterion.criterion} next steps`).toBeGreaterThan(0)
      }
    }
  })

  it('identifies MongoDB as the first near-native reference target without hiding remaining gaps', () => {
    const mongo = datastoreCompletenessForEngine('mongodb')

    expect(mongo).toMatchObject({
      readiness: 'near-native',
      nativeScore: 4,
      targetPhase: 1,
    })
    expect(mongo?.criteria.find((item) => item.criterion === 'object-views')?.status).toBe(
      'strong',
    )
    expect(mongo?.criteria.find((item) => item.criterion === 'safe-editing')?.status).toBe(
      'partial',
    )
    expect(incompleteCriteriaForEngine('mongodb').map((item) => item.criterion)).toEqual(
      expect.arrayContaining(['safe-editing', 'diagnostics-performance', 'import-export']),
    )
  })
})
