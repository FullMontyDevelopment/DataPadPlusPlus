import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  connectionHealthConnected,
  connectionHealthIssue,
} from '../../../../src/app/state/connection-health'
import {
  ConnectionHealthBadge,
  ConnectionHealthChip,
  ConnectionHealthIssueStrip,
} from '../../../../src/app/components/workbench/ConnectionHealthBadge'

describe('ConnectionHealthBadge', () => {
  it('renders unknown and connected connection states compactly', () => {
    const { rerender } = render(<ConnectionHealthBadge environmentLabel="QA" compact />)

    expect(screen.getByRole('status', { name: 'Not checked this session' })).toHaveAttribute(
      'title',
      'Not checked this session for QA.',
    )

    rerender(
      <ConnectionHealthBadge
        health={connectionHealthConnected('connection-sql', 'env-qa', 'startup', 'Ready', 11)}
        environmentLabel="QA"
        compact
      />,
    )

    const badge = screen.getByRole('status', { name: 'Connected' })
    expect(badge).toHaveClass('is-connected')
    expect(badge.getAttribute('title')).toContain('Duration: 11 ms')
  })

  it('keeps issue text subtle while preserving the redacted reason in the tooltip', () => {
    const health = connectionHealthIssue(
      'connection-mongo',
      'env-qa',
      'startup',
      'Connection failed with password=open-sesame',
    )

    render(
      <ConnectionHealthIssueStrip
        health={health}
        environmentLabel="QA"
        onEditConnection={vi.fn()}
        onTestAgain={vi.fn()}
      />,
    )

    const strip = screen.getByRole('status', { name: /Connection issue/i })
    expect(strip).toHaveTextContent('Connection issue')
    expect(strip).not.toHaveTextContent('open-sesame')
    expect(strip.getAttribute('title')).toContain('password=********')
    expect(strip.getAttribute('title')).not.toContain('open-sesame')
  })

  it('shows environment action only for environment-related issues', () => {
    const onEditConnection = vi.fn()
    const onOpenEnvironment = vi.fn()
    const onTestAgain = vi.fn()

    const { rerender } = render(
      <ConnectionHealthIssueStrip
        health={connectionHealthIssue(
          'connection-mongo',
          'env-qa',
          'startup',
          'Connection refused',
        )}
        environmentLabel="QA"
        onEditConnection={onEditConnection}
        onOpenEnvironment={onOpenEnvironment}
        onTestAgain={onTestAgain}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Open environment' })).not.toBeInTheDocument()

    rerender(
      <ConnectionHealthIssueStrip
        health={connectionHealthIssue(
          'connection-mongo',
          'env-qa',
          'startup',
          'Missing environment secret API_TOKEN',
        )}
        environmentLabel="QA"
        onEditConnection={onEditConnection}
        onOpenEnvironment={onOpenEnvironment}
        onTestAgain={onTestAgain}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open environment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection' }))
    fireEvent.click(screen.getByRole('button', { name: 'Test connection again' }))

    expect(onOpenEnvironment).toHaveBeenCalledTimes(1)
    expect(onEditConnection).toHaveBeenCalledTimes(1)
    expect(onTestAgain).toHaveBeenCalledTimes(1)
  })

  it('renders chips only for degraded or issue states', () => {
    const { rerender } = render(
      <ConnectionHealthChip
        health={connectionHealthConnected('connection-sql', 'env-qa', 'startup')}
        environmentLabel="QA"
      />,
    )

    expect(screen.queryByText('Connection reachable')).not.toBeInTheDocument()

    rerender(
      <ConnectionHealthChip
        health={connectionHealthIssue(
          'connection-sql',
          'env-qa',
          'startup',
          'Connection refused',
        )}
        environmentLabel="QA"
      />,
    )

    expect(screen.getByText('Connection refused')).toBeInTheDocument()
  })
})
