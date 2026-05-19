import { useState } from 'react'
import type { EnvironmentProfile } from '@datapadplusplus/shared-types'
import { normalizeColor, resolveEnvironmentPreview } from './EnvironmentWorkspace.helpers'

export function EnvironmentWorkspace({
  activeEnvironment,
  environments,
  onCreateEnvironment,
  onCloneEnvironment,
  onSaveEnvironment,
}: {
  activeEnvironment?: EnvironmentProfile
  environments: EnvironmentProfile[]
  onCreateEnvironment(): void
  onCloneEnvironment(environment: EnvironmentProfile): void
  onSaveEnvironment(environment: EnvironmentProfile): void
}) {
  const [environmentDraft, setEnvironmentDraft] = useState(activeEnvironment)
  const [newVariableKey, setNewVariableKey] = useState('')
  const [newVariableValue, setNewVariableValue] = useState('')
  const [newVariableSecret, setNewVariableSecret] = useState(false)

  if (!environmentDraft) {
    return (
      <section className="environment-workspace" aria-label="Environment workspace">
        <div className="environment-empty">
          <p className="sidebar-eyebrow">Environments</p>
          <h1>Create an environment.</h1>
          <p>
            Environments hold variables, risk settings, and safety behavior. Add one,
            then assign it from a connection profile.
          </p>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            onClick={onCreateEnvironment}
          >
            New Environment
          </button>
        </div>
      </section>
    )
  }

  const environmentOptions = environments.filter((item) => item.id !== environmentDraft.id)
  const variableEntries = Object.entries(environmentDraft.variables).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const resolvedPreview = resolveEnvironmentPreview(environments, environmentDraft)
  const resolvedEntries = Object.entries(resolvedPreview.variables).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const sensitiveKeys = new Set(environmentDraft.sensitiveKeys)
  const resolvedSensitiveKeys = new Set(resolvedPreview.sensitiveKeys)
  const unresolvedKeys = new Set(resolvedPreview.unresolvedKeys)
  const hasEnvironmentChanges =
    Boolean(activeEnvironment) &&
    comparableEnvironment(environmentDraft) !== comparableEnvironment(activeEnvironment)

  const updateDraft = (patch: Partial<EnvironmentProfile>) => {
    setEnvironmentDraft((current) =>
      current
        ? {
            ...current,
            ...patch,
            updatedAt: new Date().toISOString(),
          }
        : current,
    )
  }

  const updateVariableKey = (currentKey: string, nextKey: string) => {
    setEnvironmentDraft((current) => {
      if (!current) {
        return current
      }

      const variables = { ...current.variables }
      const value = variables[currentKey] ?? ''
      delete variables[currentKey]

      if (nextKey) {
        variables[nextKey] = value
      }

      return {
        ...current,
        variables,
        sensitiveKeys: current.sensitiveKeys
          .map((key) => (key === currentKey ? nextKey : key))
          .filter((key, index, keys): key is string => Boolean(key) && keys.indexOf(key) === index),
        updatedAt: new Date().toISOString(),
      }
    })
  }

  const updateVariableValue = (key: string, value: string) => {
    setEnvironmentDraft((current) =>
      current
        ? {
            ...current,
            variables: {
              ...current.variables,
              [key]: value,
            },
            updatedAt: new Date().toISOString(),
          }
        : current,
    )
  }

  const toggleSensitiveKey = (key: string) => {
    setEnvironmentDraft((current) =>
      current
        ? {
            ...current,
            sensitiveKeys: current.sensitiveKeys.includes(key)
              ? current.sensitiveKeys.filter((item) => item !== key)
              : [...current.sensitiveKeys, key],
            updatedAt: new Date().toISOString(),
          }
        : current,
    )
  }

  const deleteVariable = (key: string) => {
    if (!window.confirm(`Delete environment variable ${key}?`)) {
      return
    }

    setEnvironmentDraft((current) => {
      if (!current) {
        return current
      }

      const variables = { ...current.variables }
      delete variables[key]

      return {
        ...current,
        variables,
        sensitiveKeys: current.sensitiveKeys.filter((item) => item !== key),
        updatedAt: new Date().toISOString(),
      }
    })
  }

  const addVariable = () => {
    const key = newVariableKey.trim()

    if (!key) {
      return
    }

    const shouldMarkSensitive =
      newVariableSecret || /password|secret|token|key|pwd/i.test(key)

    setEnvironmentDraft((current) =>
      current
        ? {
            ...current,
            variables: {
              ...current.variables,
              [key]: newVariableValue,
            },
            sensitiveKeys:
              shouldMarkSensitive && !current.sensitiveKeys.includes(key)
                ? [...current.sensitiveKeys, key]
                : current.sensitiveKeys,
            updatedAt: new Date().toISOString(),
          }
        : current,
    )
    setNewVariableKey('')
    setNewVariableValue('')
    setNewVariableSecret(false)
  }

  return (
    <section className="environment-workspace" aria-label="Environment workspace">
      <div className="environment-header">
        <div>
          <p className="sidebar-eyebrow">Environment</p>
          <h1>{environmentDraft.label}</h1>
        </div>
        <div className="environment-actions">
          <button
            type="button"
            className="drawer-button"
            onClick={() => onCloneEnvironment(environmentDraft)}
          >
            Clone
          </button>
          {hasEnvironmentChanges ? (
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              onClick={() => onSaveEnvironment(environmentDraft)}
            >
              Save
            </button>
          ) : null}
        </div>
      </div>

      <div className="environment-body">
        <section className="environment-card">
          <div className="environment-section-header">
            <strong>Profile</strong>
            <span>{environmentDraft.risk}</span>
          </div>
          <div className="environment-form-grid">
            <label className="environment-field">
              <span>Label</span>
              <input
                value={environmentDraft.label}
                onChange={(event) => updateDraft({ label: event.target.value })}
              />
            </label>
            <label className="environment-field">
              <span>Color</span>
              <span className="environment-color-picker">
                <input
                  type="color"
                  aria-label="Environment color"
                  value={normalizeColor(environmentDraft.color)}
                  onChange={(event) => updateDraft({ color: event.target.value })}
                />
                <span
                  className="environment-color-swatch"
                  style={{ backgroundColor: normalizeColor(environmentDraft.color) }}
                />
              </span>
            </label>
            <label className="environment-field">
              <span>Risk</span>
              <select
                value={environmentDraft.risk}
                onChange={(event) =>
                  updateDraft({ risk: event.target.value as EnvironmentProfile['risk'] })
                }
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <label className="environment-field">
              <span>Inherits from</span>
              <select
                value={environmentDraft.inheritsFrom ?? ''}
                onChange={(event) =>
                  updateDraft({ inheritsFrom: event.target.value || undefined })
                }
              >
                <option value="">None</option>
                {environmentOptions.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="drawer-toggle-row">
            <button
              type="button"
              className={`drawer-toggle${environmentDraft.requiresConfirmation ? ' is-active' : ''}`}
              onClick={() =>
                updateDraft({
                  requiresConfirmation: !environmentDraft.requiresConfirmation,
                })
              }
            >
              Confirm risky actions
            </button>
            <button
              type="button"
              className={`drawer-toggle${environmentDraft.safeMode ? ' is-active' : ''}`}
              onClick={() => updateDraft({ safeMode: !environmentDraft.safeMode })}
            >
              Safe mode
            </button>
          </div>
        </section>

        <section className="environment-card">
          <div className="environment-section-header">
            <strong>Variables</strong>
            <span>{variableEntries.length}</span>
          </div>

          <div className="environment-variable-grid">
            {variableEntries.map(([key, value]) => {
              const secret = sensitiveKeys.has(key)
              return (
                <div key={key} className="environment-variable-row">
                  <input
                    aria-label={`Environment variable key ${key}`}
                    value={key}
                    onChange={(event) => updateVariableKey(key, event.target.value)}
                  />
                  <input
                    aria-label={`Environment variable value ${key}`}
                    value={value}
                    onChange={(event) => updateVariableValue(key, event.target.value)}
                  />
                  <button
                    type="button"
                    className={`drawer-toggle${secret ? ' is-active' : ''}`}
                    aria-label={
                      secret
                        ? `Unmark ${key} as secret`
                        : `Mark ${key} as secret`
                    }
                    onClick={() => toggleSensitiveKey(key)}
                  >
                    Secret
                  </button>
                  <button
                    type="button"
                    className="drawer-mini-button"
                    aria-label={`Delete variable ${key}`}
                    onClick={() => deleteVariable(key)}
                  >
                    x
                  </button>
                </div>
              )
            })}

            <div className="environment-variable-row environment-variable-row--new">
              <input
                aria-label="New variable key"
                placeholder="DB_HOST"
                value={newVariableKey}
                onChange={(event) => setNewVariableKey(event.target.value)}
              />
              <input
                aria-label="New variable value"
                placeholder="localhost"
                value={newVariableValue}
                onChange={(event) => setNewVariableValue(event.target.value)}
              />
              <button
                type="button"
                className={`drawer-toggle${newVariableSecret ? ' is-active' : ''}`}
                aria-label="Mark new variable as secret"
                onClick={() => setNewVariableSecret((current) => !current)}
              >
                Secret
              </button>
              <button type="button" className="drawer-button" onClick={addVariable}>
                Add
              </button>
            </div>
          </div>
        </section>

        <section className="environment-card">
          <div className="environment-section-header">
            <strong>Resolved Preview</strong>
            <span>{resolvedPreview.inheritedChain.join(' / ') || environmentDraft.label}</span>
          </div>

          {resolvedPreview.unresolvedKeys.length > 0 ? (
            <div className="drawer-callout is-error">
              <strong>Unresolved variables</strong>
              <span>{resolvedPreview.unresolvedKeys.join(', ')}</span>
            </div>
          ) : null}

          <div className="drawer-variables">
            {resolvedEntries.map(([key, value]) => {
              const hidden = resolvedSensitiveKeys.has(key)
              return (
                <div
                  key={key}
                  className={`drawer-variable-row${unresolvedKeys.has(key) ? ' is-unresolved' : ''}`}
                >
                  <span>{key}</span>
                  <code>{hidden ? '********' : value}</code>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </section>
  )
}

function comparableEnvironment(environment: EnvironmentProfile | undefined) {
  if (!environment) {
    return ''
  }

  return JSON.stringify({
    color: environment.color,
    exportable: environment.exportable,
    inheritsFrom: environment.inheritsFrom ?? '',
    label: environment.label,
    requiresConfirmation: environment.requiresConfirmation,
    risk: environment.risk,
    safeMode: environment.safeMode,
    sensitiveKeys: [...environment.sensitiveKeys].sort(),
    variables: Object.fromEntries(
      Object.entries(environment.variables).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  })
}
