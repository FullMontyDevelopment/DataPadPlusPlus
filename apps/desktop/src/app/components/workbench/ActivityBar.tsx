import type { ComponentType, SVGProps } from 'react'
import type { UiActivity, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import {
  ConnectionsIcon,
  EnvironmentsIcon,
  LightThemeIcon,
  SavedWorkIcon,
  SettingsIcon,
  TestsIcon,
  ThemeIcon,
} from './icons'
import { AppLogo } from './AppLogo'

interface ActivityBarProps {
  activeActivity: UiActivity
  sidebarCollapsed: boolean
  theme: WorkspaceSnapshot['preferences']['theme']
  onToggleSidebar(): void
  onSelectActivity(activity: UiActivity): void
  onToggleTheme(): void
}

const activityItems = [
  {
    id: 'connections',
    label: 'Connections',
    tooltip: 'Connections: create, edit, test, and organize datastore profiles.',
    icon: ConnectionsIcon,
  },
  {
    id: 'library',
    label: 'Library',
    tooltip: 'Library: organize saved queries, scripts, snippets, notes, and snapshots.',
    icon: SavedWorkIcon,
  },
  {
    id: 'tests',
    label: 'Tests',
    tooltip: 'Tests: create, run, and review datastore test suites.',
    icon: TestsIcon,
  },
  {
    id: 'environments',
    label: 'Environments',
    tooltip: 'Environments: manage variables, secrets, colors, and risk levels.',
    icon: EnvironmentsIcon,
  },
] satisfies Array<{
  id: UiActivity
  label: string
  tooltip: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}>

export function ActivityBar({
  activeActivity,
  sidebarCollapsed,
  theme,
  onToggleSidebar,
  onSelectActivity,
  onToggleTheme,
}: ActivityBarProps) {
  const ThemeGlyph = theme === 'dark' ? LightThemeIcon : ThemeIcon

  const selectActivity = (activity: UiActivity) => {
    if (activeActivity === activity && !sidebarCollapsed) {
      onToggleSidebar()
      return
    }

    onSelectActivity(activity)
  }

  return (
    <aside className="activity-bar" aria-label="Activity bar">
      <div className="activity-brand" title="DataPad++">
        <AppLogo kind="mark" />
      </div>

      <div className="activity-stack">
        {activityItems.map((item) => {
          const Icon = item.icon
          const active = activeActivity === item.id

          return (
            <button
              key={item.id}
              type="button"
              className={`activity-button${active ? ' is-active' : ''}`}
              aria-label={`${item.label} view`}
              title={item.tooltip}
              onClick={() => selectActivity(item.id)}
            >
              <Icon className="activity-icon" />
            </button>
          )
        })}
      </div>

      <div className="activity-spacer" />

      <div className="activity-stack">
        <button
          type="button"
          className={`activity-button${activeActivity === 'settings' ? ' is-active' : ''}`}
          aria-label="Settings view"
          title="Settings: diagnostics, import/export, shortcuts, and desktop preferences."
          onClick={() => onSelectActivity('settings')}
        >
          <SettingsIcon className="activity-icon" />
        </button>
        <button
          type="button"
          className="activity-button"
          aria-label="Toggle theme"
          title={
            theme === 'dark'
              ? 'Switch to light theme for the entire desktop workbench.'
              : 'Switch to dark theme for the entire desktop workbench.'
          }
          onClick={onToggleTheme}
        >
          <ThemeGlyph className="activity-icon" />
        </button>
      </div>
    </aside>
  )
}
