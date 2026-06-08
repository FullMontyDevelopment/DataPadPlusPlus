import { describe, expect, it } from 'vitest'
import {
  SEARCH_PLAIN_HTTP_RUNTIME_REASON,
  searchPreviewExecutionGate,
  searchRuntimeSupport,
} from './search-runtime-support'

describe('searchRuntimeSupport', () => {
  it('keeps plain HTTP none/basic profiles live-capable', () => {
    expect(searchRuntimeSupport({ host: 'localhost', connectionString: undefined })).toEqual({
      live: true,
      evidence: 'live',
    })

    expect(searchRuntimeSupport({
      host: 'localhost',
      connectionString: undefined,
      searchOptions: {
        connectMode: 'http',
        endpointUrl: 'http://localhost:9200/search',
        authMode: 'basic',
      },
    })).toEqual({
      live: true,
      evidence: 'live',
    })
  })

  it('explains plan-only cloud, TLS, token, and SigV4 boundaries', () => {
    expect(searchRuntimeSupport({
      host: 'localhost',
      connectionString: undefined,
      searchOptions: {
        connectMode: 'elastic-cloud',
        cloudId: 'deployment:encoded',
      },
    }).disabledReason).toContain('Elastic Cloud')

    expect(searchRuntimeSupport({
      host: 'localhost',
      connectionString: 'https://search.example.com',
      searchOptions: {
        authMode: 'api-key',
      },
    }).disabledReason).toContain('API key')

    expect(searchRuntimeSupport({
      host: 'localhost',
      connectionString: undefined,
      searchOptions: {
        connectMode: 'aws-sigv4',
        authMode: 'aws-sigv4',
        endpointUrl: 'https://search.us-east-1.es.amazonaws.com',
      },
    }).disabledReason).toContain('AWS SigV4')

    expect(searchRuntimeSupport({
      host: 'search.example.com',
      connectionString: undefined,
      searchOptions: {
        useTls: true,
        caCertificatePath: '/certs/ca.pem',
      },
    }).disabledReason).toContain('TLS')
  })

  it('keeps admin/import/export execution gated even when the runtime profile is live-capable', () => {
    expect(searchPreviewExecutionGate({
      host: 'localhost',
      connectionString: undefined,
    }, 'import-export')).toMatchObject({
      defaultSupport: 'plan-only',
      runtimeEvidence: 'live',
      disabledReasons: expect.arrayContaining([
        SEARCH_PLAIN_HTTP_RUNTIME_REASON,
      ]),
    })
  })
})
