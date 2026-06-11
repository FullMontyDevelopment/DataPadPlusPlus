import type {
  AppPreferences,
  AppShortcutId,
  KeyboardShortcutPreferences,
} from '@datapadplusplus/shared-types'

export interface ShortcutDefinition {
  id: AppShortcutId
  label: string
  group: string
  defaultShortcut: string
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: 'saveQuery', label: 'Save query', group: 'Editor', defaultShortcut: 'Ctrl+S' },
  { id: 'runQuery', label: 'Run query', group: 'Editor', defaultShortcut: 'Ctrl+Enter' },
  { id: 'explainQuery', label: 'Explain query', group: 'Editor', defaultShortcut: 'Ctrl+Shift+E' },
  { id: 'refresh', label: 'Refresh active view', group: 'Navigation', defaultShortcut: 'F5' },
  { id: 'togglePanel', label: 'Toggle bottom panel', group: 'Layout', defaultShortcut: 'Ctrl+J' },
  { id: 'toggleSidebar', label: 'Toggle sidebar', group: 'Layout', defaultShortcut: 'Ctrl+B' },
  { id: 'newQuery', label: 'New query tab', group: 'Tabs', defaultShortcut: 'Ctrl+N' },
  { id: 'closeTab', label: 'Close tab', group: 'Tabs', defaultShortcut: 'Ctrl+W' },
  { id: 'reopenClosedTab', label: 'Reopen closed tab', group: 'Tabs', defaultShortcut: 'Ctrl+Shift+T' },
]

const SHORTCUT_IDS = new Set(SHORTCUT_DEFINITIONS.map((shortcut) => shortcut.id))

export function resolveKeyboardShortcuts(
  preferences?: Pick<AppPreferences, 'keyboardShortcuts'>,
): Record<AppShortcutId, string> {
  const overrides = preferences?.keyboardShortcuts ?? {}
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [
      definition.id,
      normalizeShortcutText(overrides[definition.id] ?? definition.defaultShortcut),
    ]),
  ) as Record<AppShortcutId, string>
}

export function defaultKeyboardShortcuts(): KeyboardShortcutPreferences {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition.defaultShortcut]),
  ) as KeyboardShortcutPreferences
}

export function isShortcutId(value: string): value is AppShortcutId {
  return SHORTCUT_IDS.has(value as AppShortcutId)
}

export function normalizeShortcutText(value: string) {
  return value
    .trim()
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, '+')
    .split('+')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (lower === 'control' || lower === 'ctrl') return 'Ctrl'
      if (lower === 'cmd' || lower === 'command' || lower === 'meta') return 'Cmd'
      if (lower === 'option') return 'Alt'
      if (lower === 'shift') return 'Shift'
      if (lower === 'enter' || lower === 'return') return 'Enter'
      if (lower === 'esc') return 'Escape'
      if (/^f\d{1,2}$/i.test(part)) return part.toUpperCase()
      const firstCharacter = part[0] ?? ''
      return part.length === 1 ? part.toUpperCase() : firstCharacter.toUpperCase() + part.slice(1)
    })
    .join('+')
}

export function shortcutMatchesEvent(event: KeyboardEvent, shortcut: string) {
  const parsed = parseShortcut(shortcut)
  if (!parsed) {
    return false
  }

  const primaryPressed = event.ctrlKey || event.metaKey
  if (parsed.primary !== primaryPressed) return false
  if (parsed.shift !== event.shiftKey) return false
  if (parsed.alt !== event.altKey) return false

  return normalizeKey(event.key) === parsed.key
}

function parseShortcut(shortcut: string) {
  const parts = normalizeShortcutText(shortcut).split('+').filter(Boolean)
  const key = parts.at(-1)
  if (!key) {
    return undefined
  }

  return {
    primary: parts.some((part) => part === 'Ctrl' || part === 'Cmd'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key: normalizeKey(key),
  }
}

function normalizeKey(value: string) {
  const lower = value.toLowerCase()
  if (lower === ' ') return 'space'
  if (lower === 'escape' || lower === 'esc') return 'escape'
  if (lower === 'return') return 'enter'
  return lower
}
