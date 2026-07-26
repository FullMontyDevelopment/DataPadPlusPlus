import type {
  CosmosSqlBuilderValueType,
  CosmosSqlQueryEditorState,
} from '@datapadplusplus/shared-types'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DesktopCodeEditor } from '../../DesktopCodeEditor'
import type { DatastoreQueryEditorWorkspaceProps } from '../types'
import {
  cosmosSqlBuilderRowId,
  normalizeCosmosSqlQueryEditorState,
  validateCosmosSqlEditorState,
} from '../../query-builder/cosmos-sql'
import { cosmosSqlCompletionProvider } from './cosmos-sql-provider'

const VALUE_TYPES: CosmosSqlBuilderValueType[] = [
  'string',
  'number',
  'boolean',
  'null',
  'json',
]

export function CosmosSqlEditorWorkspace({
  tab,
  connection,
  editorState,
  value,
  theme,
  resetKey,
  completionContext,
  completionProviders,
  readOnly = false,
  onRequestCompletionRefresh,
  onSelectionChange,
  onEditorStateChange,
}: DatastoreQueryEditorWorkspaceProps) {
  const state = normalizeCosmosSqlQueryEditorState(
    editorState?.kind === 'cosmos-sql'
      ? editorState
      : defaultState(value),
  )
  const [panelOpen, setPanelOpen] = useState(true)
  const validation = validateCosmosSqlEditorState(state, {
    database: cosmosTargetDatabase(tab) ?? connection.database,
    container: cosmosTargetContainer(tab),
  })
  const editorProviders = [
    ...completionProviders.filter((provider) => provider.id !== 'cosmos-sql'),
    cosmosSqlCompletionProvider(state.parameters),
  ]

  const update = (patch: Partial<CosmosSqlQueryEditorState>) => {
    if (readOnly) return
    onEditorStateChange({
      ...state,
      ...patch,
      kind: 'cosmos-sql',
    })
  }

  return (
    <section
      className={`cosmos-sql-editor-workspace${panelOpen ? ' has-options' : ''}`}
      aria-label="Cosmos DB Query Editor"
    >
      <div className="cosmos-sql-editor-workspace__editor">
        <DesktopCodeEditor
          value={state.sql}
          language="sql"
          theme={theme}
          resetKey={resetKey}
          ariaLabel="Cosmos DB SQL query editor"
          completionContext={completionContext
            ? { ...completionContext, language: 'sql', queryText: state.sql }
            : undefined}
          completionProviders={editorProviders}
          readOnly={readOnly}
          onRequestCompletionRefresh={onRequestCompletionRefresh}
          onSelectionChange={onSelectionChange}
          onChange={(sql) => update({ sql, source: 'custom' })}
        />
      </div>

      {panelOpen ? (
        <aside className="cosmos-sql-options" aria-label="Parameters and routing">
          <header className="cosmos-sql-options__header">
            <div>
              <h3>Parameters and routing</h3>
              <p>Bind values separately from the query text.</p>
            </div>
            <button
              type="button"
              className="toolbar-icon-action"
              aria-label="Collapse parameters and routing"
              onClick={() => setPanelOpen(false)}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </header>

          <section className="cosmos-sql-options__section">
            <div className="cosmos-sql-options__section-header">
              <h4>Parameters</h4>
              <button
                type="button"
                className="query-builder-action"
                disabled={readOnly}
                onClick={() => update({
                  parameters: [
                    ...state.parameters,
                    {
                      id: cosmosSqlBuilderRowId('parameter'),
                      name: '@parameter',
                      valueType: 'string',
                      value: '',
                    },
                  ],
                })}
              >
                <Plus size={13} aria-hidden="true" /> Add
              </button>
            </div>
            {state.parameters.length === 0 ? (
              <p className="query-builder-empty">No parameter bindings.</p>
            ) : state.parameters.map((parameter) => (
              <div className="cosmos-sql-parameter" key={parameter.id}>
                <input
                  aria-label="Parameter name"
                  value={parameter.name}
                  disabled={readOnly}
                  onChange={(event) => update({
                    parameters: state.parameters.map((item) =>
                      item.id === parameter.id ? { ...item, name: event.target.value } : item),
                  })}
                />
                <select
                  aria-label={`Type for ${parameter.name || 'parameter'}`}
                  value={parameter.valueType}
                  disabled={readOnly}
                  onChange={(event) => update({
                    parameters: state.parameters.map((item) =>
                      item.id === parameter.id
                        ? { ...item, valueType: event.target.value as CosmosSqlBuilderValueType }
                        : item),
                  })}
                >
                  {VALUE_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}
                </select>
                <input
                  aria-label={`Value for ${parameter.name || 'parameter'}`}
                  value={parameter.value}
                  disabled={readOnly || parameter.valueType === 'null'}
                  onChange={(event) => update({
                    parameters: state.parameters.map((item) =>
                      item.id === parameter.id ? { ...item, value: event.target.value } : item),
                  })}
                />
                <button
                  type="button"
                  className="query-builder-remove query-builder-remove--icon"
                  aria-label={`Remove ${parameter.name || 'parameter'}`}
                  disabled={readOnly}
                  onClick={() => update({
                    parameters: state.parameters.filter((item) => item.id !== parameter.id),
                  })}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </section>

          <section className="cosmos-sql-options__section">
            <h4>Routing</h4>
            <label className="query-builder-toggle">
              <input
                type="checkbox"
                checked={Boolean(state.partitionKeyEnabled)}
                disabled={readOnly}
                onChange={(event) => update({ partitionKeyEnabled: event.target.checked })}
              />
              Route to one partition
            </label>
            {state.partitionKeyEnabled ? (
              <div className="cosmos-sql-routing-value">
                <select
                  aria-label="Partition key type"
                  value={state.partitionKeyValueType ?? 'string'}
                  disabled={readOnly}
                  onChange={(event) => update({
                    partitionKeyValueType: event.target.value as CosmosSqlBuilderValueType,
                  })}
                >
                  {VALUE_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}
                </select>
                <input
                  aria-label="Partition key value"
                  value={state.partitionKeyValue ?? ''}
                  disabled={readOnly || state.partitionKeyValueType === 'null'}
                  onChange={(event) => update({ partitionKeyValue: event.target.value })}
                />
              </div>
            ) : (
              <>
                <label className="query-builder-toggle">
                  <input
                    type="checkbox"
                    checked={state.enableCrossPartitionQueries ?? true}
                    disabled={readOnly}
                    onChange={(event) => update({
                      enableCrossPartitionQueries: event.target.checked,
                    })}
                  />
                  Enable cross-partition execution
                </label>
                {state.enableCrossPartitionQueries ?? true ? (
                  <p className="cosmos-sql-options__warning">
                    This query may fan out across partitions and consume more RUs.
                  </p>
                ) : null}
              </>
            )}
          </section>

          {validation.errors.length > 0 || validation.warnings.length > 0 ? (
            <section className="cosmos-sql-options__messages" aria-live="polite">
              {validation.errors.map((message) => (
                <p className="is-error" key={message}>{message}</p>
              ))}
              {validation.warnings.map((message) => (
                <p className="is-warning" key={message}>{message}</p>
              ))}
            </section>
          ) : null}
        </aside>
      ) : (
        <button
          type="button"
          className="cosmos-sql-options-toggle"
          aria-label="Open parameters and routing"
          onClick={() => setPanelOpen(true)}
        >
          <ChevronLeft size={15} aria-hidden="true" />
          <span>Parameters</span>
        </button>
      )}
    </section>
  )
}

function cosmosTargetDatabase(tab: DatastoreQueryEditorWorkspaceProps['tab']) {
  const path = tab.scopedTarget?.path ?? []
  return path.length > 1 ? path.at(-2) : undefined
}

function cosmosTargetContainer(tab: DatastoreQueryEditorWorkspaceProps['tab']) {
  return tab.scopedTarget?.path?.at(-1) ?? tab.scopedTarget?.scope ?? ''
}

function defaultState(sql: string): CosmosSqlQueryEditorState {
  return {
    kind: 'cosmos-sql',
    sql,
    parameters: [],
    partitionKeyEnabled: false,
    partitionKeyValue: '',
    partitionKeyValueType: 'string',
    enableCrossPartitionQueries: true,
    source: 'default',
  }
}
