import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CockroachObjectViewInsights } from '../../../../../../src/app/components/workbench/datastores/cockroachdb/CockroachObjectViewInsights'

describe('CockroachObjectViewInsights', () => {
  it('renders CockroachDB table, cluster, locality, job, contention, and security posture without raw payload text', () => {
    render(
      <CockroachObjectViewInsights
        kind="cluster"
        payload={{
          engine: 'cockroachdb',
          tableCount: 3,
          rowCount: 479,
          indexCount: 8,
          tables: [{ name: 'accounts', type: 'regional table', rows: 128 }],
          indexes: [{ name: 'accounts_pkey', unique: true, valid: true }],
          statistics: [{ name: 'public.accounts', rows: 128, scans: 9 }],
          zoneConfigurations: [{ target: 'public.accounts', numReplicas: 3, constraints: '+region=us-east', leasePreferences: '+region=us-east' }],
          nodeCount: 3,
          rangeCount: 184,
          regionCount: 2,
          nodes: [{ nodeId: 1, address: 'n1.local:26257', locality: 'region=us-east', ranges: 68, status: 'live' }],
          ranges: [{ rangeId: 42, table: 'public.accounts', replicas: '1,2,3', leaseholder: 1, qps: 18 }],
          regions: [{ region: 'us-east', survivalGoal: 'zone failure', constraints: '+region=us-east' }],
          clusterSettings: [{ name: 'kv.rangefeed.enabled', value: 'true' }],
          jobs: [
            { id: 101, type: 'SCHEMA CHANGE', status: 'succeeded', fraction: 1 },
            { id: 102, type: 'BACKUP', status: 'paused', fraction: 0.42 },
          ],
          activeSessions: 5,
          blockedSessions: 1,
          retryCount: 2,
          sessions: [{ sessionId: 's1', user: 'app', state: 'active', blockedBy: '' }],
          statements: [{ query: 'select * from public.accounts', meanMs: 12, retries: 1 }],
          contention: [{ table: 'public.accounts', durationMs: 18, blockingTxn: 'txn-00' }],
          locks: [{ sessionId: 's1', object: 'public.accounts', granted: true }],
          roles: [{ name: 'root', login: true, superuser: true, memberships: '' }],
          permissions: [{ principal: 'app_reader', privilege: 'SELECT', object: 'public.accounts' }],
          certificates: [{ subject: 'node', validUntil: '2027-01-01' }],
        }}
      />,
    )

    expect(screen.getByLabelText('CockroachDB table posture')).toBeInTheDocument()
    expect(screen.getByLabelText('CockroachDB cluster posture')).toBeInTheDocument()
    expect(screen.getByLabelText('CockroachDB locality posture')).toBeInTheDocument()
    expect(screen.getByLabelText('CockroachDB job posture')).toBeInTheDocument()
    expect(screen.getByLabelText('CockroachDB contention posture')).toBeInTheDocument()
    expect(screen.getByLabelText('CockroachDB security posture')).toBeInTheDocument()
    expect(screen.getByText('n1.local:26257')).toBeInTheDocument()
    expect(screen.getByText('SCHEMA CHANGE')).toBeInTheDocument()
    expect(screen.getAllByText('public.accounts').length).toBeGreaterThan(0)
    expect(screen.queryByText(/raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('renders nothing for non CockroachDB payloads', () => {
    const { container } = render(
      <CockroachObjectViewInsights
        kind="cluster"
        payload={{
          engine: 'postgresql',
          nodes: [{ address: 'n1.local:26257' }],
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
