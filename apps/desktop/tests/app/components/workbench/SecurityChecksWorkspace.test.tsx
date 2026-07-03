import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createBlankSnapshot } from '../../../../src/app/data/workspace-factory'
import { SecurityChecksWorkspace } from '../../../../src/app/components/workbench/SecurityChecksWorkspace'

function renderSecurityChecks(
  snapshot = securitySnapshot(),
  overrides: Partial<Parameters<typeof SecurityChecksWorkspace>[0]> = {},
) {
  const props = {
    enabled: true,
    snapshot,
    onOpenExperimentalSettings: vi.fn(),
    onMutedFindingIdsChange: vi.fn().mockResolvedValue(true),
    onRefresh: vi.fn().mockResolvedValue(true),
    ...overrides,
  }

  render(<SecurityChecksWorkspace {...props} />)
  return props
}

describe('SecurityChecksWorkspace', () => {
  it('renders one connections table with findings nested under each connection', () => {
    renderSecurityChecks()

    expect(
      screen.getByRole('table', { name: 'Security check connections and findings' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Targets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Findings' })).not.toBeInTheDocument()
    expect(screen.getByText('Fixture PostgreSQL')).toBeInTheDocument()
    expect(screen.getByText('Fixture MongoDB')).toBeInTheDocument()
    expect(screen.getByText('CVE-2026-0001')).toBeInTheDocument()
  })

  it('collapses and expands connection findings', () => {
    renderSecurityChecks()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse findings for Fixture PostgreSQL' }))

    expect(screen.queryByText('CVE-2026-0001')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand findings for Fixture PostgreSQL' }))

    expect(screen.getByText('CVE-2026-0001')).toBeInTheDocument()
  })

  it('opens and closes the selected CVE details panel', () => {
    renderSecurityChecks()

    expect(screen.queryByRole('region', { name: 'CVE-2026-0001 details' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View CVE-2026-0001 details for Fixture PostgreSQL' }))

    expect(screen.getByRole('region', { name: 'CVE-2026-0001 details' })).toBeInTheDocument()
    expect(screen.getByText('Upgrade PostgreSQL.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'NVD' })).toHaveAttribute(
      'href',
      'https://nvd.nist.gov/vuln/detail/CVE-2026-0001',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close finding details' }))

    expect(screen.queryByRole('region', { name: 'CVE-2026-0001 details' })).not.toBeInTheDocument()
  })

  it('mutes a selected finding through the detail panel', async () => {
    const onMutedFindingIdsChange = vi.fn().mockResolvedValue(true)
    renderSecurityChecks(securitySnapshot(), { onMutedFindingIdsChange })

    fireEvent.click(screen.getByRole('button', { name: 'View CVE-2026-0001 details for Fixture PostgreSQL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mute CVE-2026-0001' }))

    expect(onMutedFindingIdsChange).toHaveBeenCalledWith(['finding-cve-1'])
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'CVE-2026-0001 details' })).not.toBeInTheDocument(),
    )
  })

  it('hides muted findings by default and can show and unmute them', () => {
    const onMutedFindingIdsChange = vi.fn().mockResolvedValue(true)
    const snapshot = securitySnapshot()
    snapshot.preferences.datastoreSecurityChecks = {
      ...snapshot.preferences.datastoreSecurityChecks,
      enabled: true,
      refreshIntervalDays: 7,
      mutedFindingIds: ['finding-cve-1'],
    }

    renderSecurityChecks(snapshot, { onMutedFindingIdsChange })

    expect(screen.queryByText('CVE-2026-0001')).not.toBeInTheDocument()
    expect(screen.getByText('HIGH').closest('.security-checks-summary-card')).toHaveTextContent('0')

    fireEvent.click(screen.getByRole('button', { name: 'Show Muted (1)' }))

    expect(screen.getByText('CVE-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('Muted')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View CVE-2026-0001 details for Fixture PostgreSQL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Unmute CVE-2026-0001' }))

    expect(onMutedFindingIdsChange).toHaveBeenCalledWith([])
  })
})

function securitySnapshot() {
  const snapshot = createBlankSnapshot()
  snapshot.preferences.datastoreSecurityChecks = {
    enabled: true,
    refreshIntervalDays: 7,
  }
  snapshot.datastoreSecurityChecks = {
    status: 'ready',
    checkedAt: '2026-05-29T00:00:00.000Z',
    expiresAt: '2026-06-05T00:00:00.000Z',
    sourceMetadata: [],
    warnings: [],
    errors: [],
    targets: [
      {
        id: 'target-postgres',
        connectionId: 'conn-postgres',
        environmentId: 'env-dev',
        connectionName: 'Fixture PostgreSQL',
        environmentName: 'Dev',
        engine: 'postgresql',
        family: 'sql',
        status: 'checked',
        detectedVersion: '15.2',
        cpeCandidates: [],
        findingCount: 1,
        highestSeverity: 'HIGH',
        warnings: [],
      },
      {
        id: 'target-mongo',
        connectionId: 'conn-mongo',
        environmentId: 'env-prod',
        connectionName: 'Fixture MongoDB',
        environmentName: 'Prod',
        engine: 'mongodb',
        family: 'document',
        status: 'checked',
        detectedVersion: '6.0',
        cpeCandidates: [],
        findingCount: 0,
        warnings: [],
      },
    ],
    findings: [
      {
        id: 'finding-cve-1',
        targetIds: ['target-postgres'],
        cveId: 'CVE-2026-0001',
        title: 'PostgreSQL privilege issue',
        summary: 'A privilege escalation issue.',
        severity: 'HIGH',
        cvssScore: 8.1,
        publishedAt: '2026-05-10T00:00:00.000Z',
        modifiedAt: '2026-05-20T00:00:00.000Z',
        affectedProduct: 'PostgreSQL',
        affectedVersion: '15.2',
        remediation: 'Upgrade PostgreSQL.',
        references: [
          {
            label: 'NVD',
            url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-0001',
          },
        ],
        cwes: [],
        knownExploited: true,
        sourceUrls: [],
      },
    ],
  }
  return snapshot
}
