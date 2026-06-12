import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { AppShortcutId, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import {
  normalizeShortcutText,
  resolveKeyboardShortcuts,
  SHORTCUT_DEFINITIONS,
} from '../../keyboard-shortcuts'
import { RefreshIcon, SettingsIcon } from './icons'
import {
  SettingsNotice,
  type SettingsNoticeMessage,
  SettingsPanel,
} from './SettingsWorkspace.parts'

export function SettingsShortcutsPanel({
  preferences,
  onSetKeyboardShortcut,
}: {
  preferences: WorkspaceSnapshot['preferences']
  onSetKeyboardShortcut(shortcutId: AppShortcutId, shortcut: string): Promise<void>
}) {
  const resolved = useMemo(() => resolveKeyboardShortcuts(preferences), [preferences])
  const [drafts, setDrafts] = useState<Record<AppShortcutId, string>>(resolved)
  const [notice, setNotice] = useState<SettingsNoticeMessage>()
  const duplicateShortcuts = useMemo(() => findDuplicateShortcuts(drafts), [drafts])

  const saveShortcut = async (shortcutId: AppShortcutId, shortcut: string) => {
    const normalized = normalizeShortcutText(shortcut)
    if (!normalized || duplicateShortcuts.has(normalized)) {
      setNotice({ text: 'Shortcut was not saved.', tone: 'warning' })
      return
    }
    await onSetKeyboardShortcut(shortcutId, normalized)
    setNotice({ text: 'Shortcut saved.', tone: 'success' })
  }

  return (
    <SettingsPanel title="Shortcuts" icon={<SettingsIcon className="panel-inline-icon" />}>
      <div className="settings-shortcut-table" role="table" aria-label="Keyboard shortcuts">
        <div className="settings-shortcut-row settings-shortcut-row--header" role="row">
          <span>Action</span>
          <span>Scope</span>
          <span>Shortcut</span>
          <span />
        </div>
        {SHORTCUT_DEFINITIONS.map((definition) => {
          const draft = drafts[definition.id]
          const normalized = normalizeShortcutText(draft)
          const duplicate = duplicateShortcuts.has(normalized)
          return (
            <div key={definition.id} className={`settings-shortcut-row${duplicate ? ' is-warning' : ''}`} role="row">
              <span>{definition.label}</span>
              <span>{definition.group}</span>
              <input
                aria-label={`${definition.label} shortcut`}
                value={draft}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [definition.id]: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  const next = shortcutFromInputEvent(event)
                  if (!next) return
                  event.preventDefault()
                  setDrafts((current) => ({ ...current, [definition.id]: next }))
                }}
                onBlur={() => void saveShortcut(definition.id, draft)}
              />
              <span className="settings-table-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Reset ${definition.label}`}
                  onClick={() => {
                    setDrafts((current) => ({
                      ...current,
                      [definition.id]: definition.defaultShortcut,
                    }))
                    void saveShortcut(definition.id, definition.defaultShortcut)
                  }}
                >
                  <RefreshIcon className="panel-inline-icon" />
                </button>
              </span>
            </div>
          )
        })}
      </div>
      <SettingsNotice notice={notice} />
    </SettingsPanel>
  )
}

function findDuplicateShortcuts(values: Record<AppShortcutId, string>) {
  const counts = new Map<string, number>()
  for (const shortcut of Object.values(values)) {
    const normalized = normalizeShortcutText(shortcut)
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([shortcut]) => shortcut))
}

function shortcutFromInputEvent(event: KeyboardEvent<HTMLInputElement>) {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) {
    return undefined
  }

  const parts = [
    event.ctrlKey || event.metaKey ? 'Ctrl' : undefined,
    event.altKey ? 'Alt' : undefined,
    event.shiftKey ? 'Shift' : undefined,
    event.key,
  ].filter(Boolean)

  return normalizeShortcutText(parts.join('+'))
}
