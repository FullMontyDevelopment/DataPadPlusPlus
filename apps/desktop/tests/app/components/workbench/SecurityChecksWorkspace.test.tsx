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
    expect(screen.getByText('Known newer: 18.4')).toBeInTheDocument()
    expect(screen.getByText('Recommended: 18.4')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Vulnerabilities 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Posture 1' })).toBeInTheDocument()
    expect(screen.getByText('CVE-2026-0001')).toBeInTheDocument()
  })

  it('collapses and expands connection findings', () => {
    renderSecurityChecks()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse findings for Fixture PostgreSQL' }))

    expect(screen.queryByText('CVE-2026-0001')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand findings for Fixture PostgreSQL' }))

    expect(screen.getByText('CVE-2026-0001')).toBeInTheDocument()
  })

  it('shows full guidance content in a hover tooltip', () => {
    renderSecurityChecks()

    const guidanceTrigger = screen
      .getByText('Recommended: 18.4')
      .closest('.security-checks-guidance-trigger')

    expect(guidanceTrigger).not.toHaveAttribute('title')

    fireEvent.mouseEnter(guidanceTrigger!)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Recommended: 18.4')
    expect(tooltip).toHaveTextContent('Detected: 15.2')
    expect(tooltip).toHaveTextContent('Known newer: 18.4')
    expect(tooltip).toHaveTextContent('Catalog updated:')

    fireEvent.mouseLeave(guidanceTrigger!)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('does not duplicate status-only guidance in the tooltip', () => {
    const snapshot = securitySnapshot()
    const message =
      'DataPad++ could not detect a product version for Test Redis using read-only probes.'
    snapshot.datastoreSecurityChecks!.targets = [
      {
        id: 'target-redis',
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        connectionName: 'Test Redis',
        environmentName: 'Dev',
        engine: 'redis',
        family: 'keyvalue',
        status: 'versionUnavailable',
        message,
        cpeCandidates: [],
        findingCount: 0,
        warnings: [],
      },
    ]
    snapshot.datastoreSecurityChecks!.findings = []

    renderSecurityChecks(snapshot)

    const guidanceTrigger = screen
      .getByText(message)
      .closest('.security-checks-guidance-trigger')

    expect(guidanceTrigger).not.toHaveAttribute('title')

    fireEvent.mouseEnter(guidanceTrigger!)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent(message)
    expect(tooltip).not.toHaveTextContent('Scan status:')
  })

  it('opens and closes the selected CVE details panel', () => {
    renderSecurityChecks()

    expect(screen.queryByRole('region', { name: 'CVE-2026-0001 details' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View CVE-2026-0001 details for Fixture PostgreSQL' }))

    expect(screen.getByRole('region', { name: 'CVE-2026-0001 details' })).toBeInTheDocument()
    expect(screen.getByText('Upgrade PostgreSQL.')).toBeInTheDocument()
    expect(screen.getByText('>= 15.5')).toBeInTheDocument()
    expect(screen.getAllByText('>= 15.0 and < 15.5').length).toBeGreaterThan(0)
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
    snapshot.datastoreSecurityChecks!.postureChecks = []

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

  it('shows posture checks in a separate lane with pass rows hidden by default', () => {
    renderSecurityChecks()

    fireEvent.click(screen.getByRole('tab', { name: 'Posture 1' }))

    expect(screen.getByText('High-risk environment is not read-only')).toBeInTheDocument()
    expect(screen.queryByText('Transport encryption posture is acceptable')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show Passing' }))

    expect(screen.getByText('Transport encryption posture is acceptable')).toBeInTheDocument()
  })

  it('opens and mutes posture check details', async () => {
    const onMutedFindingIdsChange = vi.fn().mockResolvedValue(true)
    renderSecurityChecks(securitySnapshot(), { onMutedFindingIdsChange })

    fireEvent.click(screen.getByRole('tab', { name: 'Posture 1' }))
    fireEvent.click(
      screen.getByRole('button', {
        name: 'View High-risk environment is not read-only posture check for Fixture MongoDB',
      }),
    )

    expect(
      screen.getByRole('region', { name: 'High-risk environment is not read-only posture check' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Environment risk: critical. Connection read-only: false.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mute High-risk environment is not read-only' }))

    expect(onMutedFindingIdsChange).toHaveBeenCalledWith(['posture-target-mongo-profile-high-risk-readonly'])
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'High-risk environment is not read-only posture check' }),
      ).not.toBeInTheDocument(),
    )
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
        knownLatestVersion: '18.4',
        recommendedVersion: '18.4',
        versionStatus: 'updateAvailable',
        versionSource: 'bundled-catalog',
        versionSourceLabel: 'PostgreSQL release notes',
        versionSourceUpdatedAt: '2026-07-04',
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
        knownLatestVersion: '8.3',
        recommendedVersion: '8.0',
        versionStatus: 'unsupported',
        versionSource: 'bundled-catalog',
        versionSourceLabel: 'MongoDB release notes',
        versionSourceUpdatedAt: '2026-07-04',
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
        affectedVersionRange: '>= 15.0 and < 15.5',
        fixedVersionHint: '>= 15.5',
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
    postureChecks: [
      {
        id: 'posture-target-postgres-profile-transport',
        targetIds: ['target-postgres'],
        ruleId: 'profile.transport',
        category: 'transport',
        status: 'pass',
        severity: 'NONE',
        title: 'Transport encryption posture is acceptable',
        summary: 'The profile requires TLS and does not explicitly disable certificate verification.',
        evidence: 'SSL mode: verify-full.',
        remediation: 'Keep TLS and certificate verification enabled.',
        source: 'profile',
        references: [],
      },
      {
        id: 'posture-target-mongo-profile-high-risk-readonly',
        targetIds: ['target-mongo'],
        ruleId: 'profile.high-risk-readonly',
        category: 'environment',
        status: 'fail',
        severity: 'HIGH',
        title: 'High-risk environment is not read-only',
        summary:
          'The connection is attached to a high or critical risk environment without the connection-level read-only guard.',
        evidence: 'Environment risk: critical. Connection read-only: false.',
        remediation: 'Enable read-only mode for production-like profiles.',
        source: 'profile',
        references: [
          {
            label: 'MongoDB Security Checklist',
            url: 'https://www.mongodb.com/docs/manual/administration/security-checklist/',
          },
        ],
      },
    ],
  }
  return snapshot
}
