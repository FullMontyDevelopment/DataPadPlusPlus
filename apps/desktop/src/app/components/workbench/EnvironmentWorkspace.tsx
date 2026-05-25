import { useState } from 'react'
import type { EnvironmentProfile } from '@datapadplusplus/shared-types'
import { comparableEnvironment, normalizeColor } from './EnvironmentWorkspace.helpers'
import { EnvironmentVariableDeleteDialog } from './EnvironmentVariableDeleteDialog'
import { EnvironmentVariableSecretToggle } from './EnvironmentVariableSecretToggle'
import { TrashIcon } from './icons'
import {
  isValidVariableName,
  normalizeVariableName,
  sanitizeEnvironmentProfile,
  secretRefForEnvironmentVariable,
  variableDefinitionsForEnvironment,
} from '../../state/environment-variables'

export function EnvironmentWorkspace({
  activeEnvironment,
  environments,
  onCreateEnvironment,
  onCloneEnvironment,
  onEnvironmentChange,
  onSaveEnvironment,
  secretDrafts = {},
  onSecretDraftsChange,
}: {
  activeEnvironment?: EnvironmentProfile
  environments: EnvironmentProfile[]
  onCreateEnvironment(): void
  onCloneEnvironment(environment: EnvironmentProfile): void
  onEnvironmentChange(environment: EnvironmentProfile): void
  onSaveEnvironment(environment: EnvironmentProfile, secretDrafts?: Record<string, string>): void
  secretDrafts?: Record<string, string>
  onSecretDraftsChange?(secretDrafts: Record<string, string>): void
}) {
  const [newVariableKey, setNewVariableKey] = useState('')
  const [newVariableValue, setNewVariableValue] = useState('')
  const [newVariableSecret, setNewVariableSecret] = useState(false)
  const [pendingVariableDelete, setPendingVariableDelete] = useState<string>()
  const environmentDraft = activeEnvironment

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
  const variableDefinitions = variableDefinitionsForEnvironment(environmentDraft)
  const hasEnvironmentChanges =
    Boolean(activeEnvironment) &&
    comparableEnvironment(environmentDraft) !==
      comparableEnvironment(environments.find((item) => item.id === environmentDraft.id))

  const commitDraft = (
    updater:
      | Partial<EnvironmentProfile>
      | ((current: EnvironmentProfile) => EnvironmentProfile),
  ) => {
    const nextEnvironment =
      typeof updater === 'function'
        ? updater(environmentDraft)
        : {
            ...environmentDraft,
            ...updater,
            updatedAt: new Date().toISOString(),
          }

    onEnvironmentChange(sanitizeEnvironmentProfile(nextEnvironment))
  }

  const updateDraft = (patch: Partial<EnvironmentProfile>) => {
    commitDraft(patch)
  }

  const updateVariableKey = (currentKey: string, nextKey: string) => {
    const normalizedNextKey = normalizeVariableName(nextKey)
    commitDraft((current) => {
      const definitions = variableDefinitionsForEnvironment(current)
        .filter((definition) => definition.key !== currentKey)
      const currentDefinition = variableDefinitionsForEnvironment(current).find(
        (definition) => definition.key === currentKey,
      )

      if (currentDefinition && isValidVariableName(normalizedNextKey)) {
        definitions.push({
          ...currentDefinition,
          key: normalizedNextKey,
          secretRef:
            currentDefinition.kind === 'secret'
              ? secretRefForEnvironmentVariable(current.id, normalizedNextKey)
              : undefined,
          updatedAt: new Date().toISOString(),
        })
      }

      if (secretDrafts[currentKey] !== undefined) {
        const nextDrafts = { ...secretDrafts }
        const draft = nextDrafts[currentKey] ?? ''
        delete nextDrafts[currentKey]
        if (isValidVariableName(normalizedNextKey)) {
          nextDrafts[normalizedNextKey] = draft
        }
        onSecretDraftsChange?.(nextDrafts)
      }

      return sanitizeEnvironmentProfile({
        ...current,
        variableDefinitions: definitions,
        updatedAt: new Date().toISOString(),
      })
    })
  }

  const updateVariableValue = (key: string, value: string) => {
    commitDraft((current) => ({
      ...current,
      variableDefinitions: variableDefinitionsForEnvironment(current).map((definition) =>
        definition.key === key
          ? { ...definition, value, updatedAt: new Date().toISOString() }
          : definition,
      ),
      updatedAt: new Date().toISOString(),
    }))
  }

  const updateSecretDraft = (key: string, value: string) => {
    onSecretDraftsChange?.({
      ...secretDrafts,
      [key]: value,
    })
  }

  const setVariableKind = (key: string, kind: 'text' | 'secret') => {
    commitDraft((current) => ({
      ...current,
      variableDefinitions: variableDefinitionsForEnvironment(current).map((definition) =>
        definition.key === key
          ? {
              ...definition,
              kind,
              value: kind === 'secret' ? undefined : definition.value ?? '',
              secretRef:
                kind === 'secret'
                  ? definition.secretRef ??
                    secretRefForEnvironmentVariable(current.id, definition.key)
                  : undefined,
              updatedAt: new Date().toISOString(),
            }
          : definition,
      ),
      updatedAt: new Date().toISOString(),
    }))
  }

  const deleteVariable = (key: string) => {
    commitDraft((current) => {
      const definitions = variableDefinitionsForEnvironment(current).filter(
        (definition) => definition.key !== key,
      )
      const nextDrafts = { ...secretDrafts }
      delete nextDrafts[key]
      onSecretDraftsChange?.(nextDrafts)

      return {
        ...current,
        variableDefinitions: definitions,
        updatedAt: new Date().toISOString(),
      }
    })
  }

  const addVariable = () => {
    const key = normalizeVariableName(newVariableKey)

    if (!isValidVariableName(key)) {
      return
    }

    const shouldMarkSensitive =
      newVariableSecret || /password|secret|token|key|pwd/i.test(key)

    commitDraft((current) => ({
      ...current,
      variableDefinitions: [
        ...variableDefinitionsForEnvironment(current).filter(
          (definition) => definition.key !== key,
        ),
        {
          key,
          kind: shouldMarkSensitive ? 'secret' : 'text',
          value: shouldMarkSensitive ? undefined : newVariableValue,
          secretRef: shouldMarkSensitive
            ? secretRefForEnvironmentVariable(current.id, key)
            : undefined,
          updatedAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    }))
    if (shouldMarkSensitive && newVariableValue) {
      updateSecretDraft(key, newVariableValue)
    }
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
              onClick={() => onSaveEnvironment(sanitizeEnvironmentProfile(environmentDraft), secretDrafts)}
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
            <span>{variableDefinitions.length}</span>
          </div>

          <div className="environment-variable-grid">
            {variableDefinitions.map((definition) => {
              const key = definition.key
              const secret = definition.kind === 'secret'
              return (
                <div key={key} className="environment-variable-row">
                  <input
                    aria-label={`Environment variable key ${key}`}
                    value={key}
                    onChange={(event) => updateVariableKey(key, event.target.value)}
                  />
                  {secret ? (
                    <input
                      aria-label={`Environment secret value ${key}`}
                      type="password"
                      placeholder={definition.secretRef ? 'Stored secret' : 'Enter secret'}
                      value={secretDrafts[key] ?? ''}
                      onChange={(event) => updateSecretDraft(key, event.target.value)}
                    />
                  ) : (
                    <input
                      aria-label={`Environment variable value ${key}`}
                      value={definition.value ?? ''}
                      onChange={(event) => updateVariableValue(key, event.target.value)}
                    />
                  )}
                  <EnvironmentVariableSecretToggle
                    secret={secret}
                    label={`Environment variable type ${key}`}
                    onToggle={() => setVariableKind(key, secret ? 'text' : 'secret')}
                  />
                  <button
                    type="button"
                    className="drawer-mini-button"
                    aria-label={`Delete variable ${key}`}
                    title={`Delete ${key}`}
                    onClick={() => setPendingVariableDelete(key)}
                  >
                    <TrashIcon className="toolbar-icon" />
                  </button>
                </div>
              )
            })}

            <div className="environment-variable-row environment-variable-row--new">
              <input
                aria-label="New variable key"
                placeholder="DB_HOST"
                value={newVariableKey}
                onChange={(event) => setNewVariableKey(event.target.value.toUpperCase())}
              />
              <input
                aria-label="New variable value"
                type={newVariableSecret ? 'password' : 'text'}
                placeholder="localhost"
                value={newVariableValue}
                onChange={(event) => setNewVariableValue(event.target.value)}
              />
              <EnvironmentVariableSecretToggle
                secret={newVariableSecret}
                label="Mark new variable as secret"
                onToggle={() => setNewVariableSecret((current) => !current)}
              />
              <button type="button" className="drawer-button" onClick={addVariable}>
                Add
              </button>
            </div>
          </div>
        </section>
      </div>
      {pendingVariableDelete ? (
        <EnvironmentVariableDeleteDialog
          variableName={pendingVariableDelete}
          onCancel={() => setPendingVariableDelete(undefined)}
          onConfirm={() => {
            const variableName = pendingVariableDelete
            setPendingVariableDelete(undefined)
            deleteVariable(variableName)
          }}
        />
      ) : null}
    </section>
  )
}
