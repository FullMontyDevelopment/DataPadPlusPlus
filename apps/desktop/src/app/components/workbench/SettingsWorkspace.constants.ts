import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'

export type SettingsSection =
  | 'appearance'
  | 'workspace'
  | 'updates'
  | 'security'
  | 'shortcuts'
  | 'logs'
  | 'about'

export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'workspace', label: 'Workspace + Backups' },
  { id: 'updates', label: 'Updates' },
  { id: 'security', label: 'Security' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'logs', label: 'Logs' },
  { id: 'about', label: 'About' },
]

export const THEMES: Array<{
  id: WorkspaceSnapshot['preferences']['theme']
  label: string
  base: 'light' | 'dark'
  colors: {
    background: string
    surface: string
    accent: string
    text: string
  }
}> = [
  { id: 'system', label: 'System', base: 'dark', colors: { background: '#15171c', surface: '#252a33', accent: '#4ec9b0', text: '#f4f7fb' } },
  { id: 'dark', label: 'Dark', base: 'dark', colors: { background: '#1e1e1e', surface: '#252526', accent: '#3794ff', text: '#cccccc' } },
  { id: 'light', label: 'Light', base: 'light', colors: { background: '#ffffff', surface: '#f3f3f3', accent: '#0078d4', text: '#1f2328' } },
  { id: 'midnight', label: 'Midnight', base: 'dark', colors: { background: '#0b1020', surface: '#151c33', accent: '#7aa2f7', text: '#d9e3ff' } },
  { id: 'graphite', label: 'Graphite', base: 'dark', colors: { background: '#191919', surface: '#2a2a2a', accent: '#8fbf9f', text: '#e7e7e7' } },
  { id: 'solarized-dark', label: 'Solarized Dark', base: 'dark', colors: { background: '#002b36', surface: '#073642', accent: '#2aa198', text: '#eee8d5' } },
  { id: 'solarized-light', label: 'Solarized Light', base: 'light', colors: { background: '#fdf6e3', surface: '#eee8d5', accent: '#268bd2', text: '#073642' } },
  { id: 'high-contrast', label: 'High Contrast', base: 'dark', colors: { background: '#000000', surface: '#111111', accent: '#ffff00', text: '#ffffff' } },
]
