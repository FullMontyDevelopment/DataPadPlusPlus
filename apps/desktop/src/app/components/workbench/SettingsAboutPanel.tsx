import { useState } from 'react'
import type { AppHealth, DiagnosticsReport } from '@datapadplusplus/shared-types'
import { openExternalLink } from '../../../services/runtime/external-links'
import { LogoMark } from './icons'
import {
  MetricCard,
  SettingsNotice,
  type SettingsNoticeMessage,
  SettingsPanel,
} from './SettingsWorkspace.parts'

const GITHUB_REPO_URL = 'https://github.com/FullMontyDevelopment/DataPadPlusPlus'

const GITHUB_LINKS = [
  {
    href: GITHUB_REPO_URL,
    label: 'GitHub repository',
    description: 'Source code, project history, and contribution context.',
  },
  {
    href: `${GITHUB_REPO_URL}/releases`,
    label: 'Releases',
    description: 'Published builds, release notes, and desktop installers.',
  },
  {
    href: `${GITHUB_REPO_URL}/issues`,
    label: 'Issues',
    description: 'Report bugs, request features, and follow known work.',
  },
]

export function SettingsAboutPanel({
  diagnostics,
  health,
}: {
  diagnostics?: DiagnosticsReport
  health: AppHealth
}) {
  const [notice, setNotice] = useState<SettingsNoticeMessage>()

  const handleOpenLink = async (href: string) => {
    try {
      await openExternalLink(href)
      setNotice(undefined)
    } catch (error) {
      setNotice({
        text: `The link could not be opened in your browser. ${externalLinkFailureMessage(error)}`,
        tone: 'error',
      })
    }
  }

  return (
    <SettingsPanel title="About" icon={<LogoMark className="panel-inline-icon" />}>
      <div className="settings-about-summary">
        <div className="settings-about-mark" aria-hidden="true">
          <LogoMark className="panel-inline-icon" />
        </div>
        <div className="settings-about-copy">
          <h3>DataPad++</h3>
          <p>
            A modular Tauri workstation for exploring multiple datastore families
            from one desktop app.
          </p>
          <p>
            DataPad++ focuses on connection management, object browsing, query
            execution, workspace backups, signed updates, and datastore-specific
            guardrails for day-to-day database work.
          </p>
        </div>
      </div>

      <div className="settings-metric-grid">
        <MetricCard label="Version" value={diagnostics?.appVersion ?? 'Unknown'} />
        <MetricCard label="Runtime" value={diagnostics?.runtime ?? health.runtime} />
        <MetricCard label="Platform" value={diagnostics?.platform ?? health.platform} />
      </div>

      <div className="settings-link-grid" aria-label="DataPad++ GitHub links">
        {GITHUB_LINKS.map((link) => (
          <a
            key={link.href}
            className="settings-link-card"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault()
              void handleOpenLink(link.href)
            }}
          >
            <strong>{link.label}</strong>
            <span>{link.description}</span>
          </a>
        ))}
      </div>
      <SettingsNotice notice={notice} />
    </SettingsPanel>
  )
}

function externalLinkFailureMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string' && error) {
    return error
  }
  return 'Check the desktop opener permissions and try again.'
}
