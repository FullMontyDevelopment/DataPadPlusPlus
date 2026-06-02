import type {
  CqlBuilderValueType,
  CqlConditionOperator,
  CqlConditionRow,
  CqlPartitionBuilderState,
  QueryBuilderState,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { BuilderSection } from './BuilderSection'
import {
  buildCqlPartitionQueryText,
  cqlBuilderRowId,
  newCqlCondition,
} from './cql-partition'

interface CqlPartitionBuilderProps {
  tab: QueryTabState
  builderState: CqlPartitionBuilderState
  tableOptions?: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
}

const OPERATORS: Array<{ value: CqlConditionOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'in', label: 'IN' },
  { value: 'contains', label: 'CONTAINS' },
]
const VALUE_TYPES: CqlBuilderValueType[] = ['string', 'number', 'boolean', 'null']

export function CqlPartitionBuilder({
  tab,
  builderState,
  tableOptions = [],
  onBuilderStateChange,
}: CqlPartitionBuilderProps) {
  const draft = builderState
  const tableOptionsList = uniqueValues([draft.table, ...tableOptions])
  const updateDraft = (patch: Partial<CqlPartitionBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    onBuilderStateChange?.(tab.id, {
      ...nextDraft,
      lastAppliedQueryText: buildCqlPartitionQueryText(nextDraft),
    })
  }

  return (
    <section className="query-builder-panel" aria-label="CQL partition query builder">
      <div className="query-builder-grid query-builder-grid--sql-target">
        <label className="query-builder-field">
          <span>Keyspace</span>
          <input
            aria-label="Keyspace"
            value={draft.keyspace ?? ''}
            placeholder="optional"
            onChange={(event) => updateDraft({ keyspace: event.target.value })}
          />
        </label>
        <label className="query-builder-field">
          <span>Table</span>
          <input
            aria-label="Table"
            list="cql-builder-table-options"
            value={draft.table}
            onChange={(event) => updateDraft({ table: event.target.value })}
          />
          <datalist id="cql-builder-table-options">
            {tableOptionsList.map((table) => <option key={table} value={table} />)}
          </datalist>
        </label>
        <label className="query-builder-field">
          <span>Limit</span>
          <input
            aria-label="Limit"
            min={1}
            type="number"
            value={draft.limit ?? 20}
            onChange={(event) => updateDraft({ limit: numberValue(event.target.value, 20) })}
          />
        </label>
        <label className="query-builder-toggle query-builder-toggle--inline">
          <input
            type="checkbox"
            aria-label="Allow filtering"
            checked={Boolean(draft.allowFiltering)}
            onChange={(event) => updateDraft({ allowFiltering: event.target.checked })}
          />
          Allow filtering
        </label>
      </div>

      <CqlConditionSection
        title="Partition Keys"
        actionLabel="Add Key"
        rows={draft.partitionKeys}
        updateRows={(partitionKeys) => updateDraft({ partitionKeys })}
      />
      <CqlConditionSection
        title="Clustering"
        actionLabel="Add Clustering Key"
        rows={draft.clusteringKeys}
        updateRows={(clusteringKeys) => updateDraft({ clusteringKeys })}
      />
      <CqlConditionSection
        title="Filters"
        actionLabel="Add Filter"
        rows={draft.filters}
        updateRows={(filters) => updateDraft({ filters })}
      />

      <BuilderSection
        title="Columns"
        actionLabel="Add Column"
        dropHint="Drop a field to select it"
        onAdd={() =>
          updateDraft({
            projectionFields: [
              ...draft.projectionFields,
              { id: cqlBuilderRowId('cql-projection'), field: '' },
            ],
          })
        }
        onDropField={(field) =>
          updateDraft({
            projectionFields: [
              ...draft.projectionFields,
              { id: cqlBuilderRowId('cql-projection'), field },
            ],
          })
        }
      >
        {draft.projectionFields.length === 0 ? (
          <p className="query-builder-empty">Selecting all columns.</p>
        ) : (
          draft.projectionFields.map((field) => (
            <div key={field.id} className="query-builder-row query-builder-row--simple">
              <input
                aria-label="Selected column"
                value={field.field}
                onChange={(event) =>
                  updateDraft({
                    projectionFields: draft.projectionFields.map((item) =>
                      item.id === field.id ? { ...item, field: event.target.value } : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="query-builder-remove"
                aria-label={`Remove column ${field.field || 'empty'}`}
                onClick={() =>
                  updateDraft({
                    projectionFields: draft.projectionFields.filter((item) => item.id !== field.id),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))
        )}
      </BuilderSection>
    </section>
  )
}

function CqlConditionSection({
  actionLabel,
  rows,
  title,
  updateRows,
}: {
  actionLabel: string
  rows: CqlConditionRow[]
  title: string
  updateRows(rows: CqlConditionRow[]): void
}) {
  return (
    <BuilderSection
      title={title}
      actionLabel={actionLabel}
      dropHint="Drop a field to add a condition"
      onAdd={() => updateRows([...rows, newCqlCondition()])}
      onDropField={(field) => updateRows([...rows, { ...newCqlCondition(), field }])}
    >
      {rows.length === 0 ? (
        <p className="query-builder-empty">No {title.toLowerCase()} configured.</p>
      ) : rows.map((row) => (
        <ConditionRow
          key={row.id}
          row={row}
          onChange={(patch) =>
            updateRows(rows.map((item) => item.id === row.id ? { ...item, ...patch } : item))
          }
          onRemove={() => updateRows(rows.filter((item) => item.id !== row.id))}
        />
      ))}
    </BuilderSection>
  )
}

function ConditionRow({
  row,
  onChange,
  onRemove,
}: {
  row: CqlConditionRow
  onChange(patch: Partial<CqlConditionRow>): void
  onRemove(): void
}) {
  return (
    <div className={`query-builder-row query-builder-row--filter${row.enabled === false ? ' is-disabled' : ''}`}>
      <label className="query-builder-toggle">
        <input
          type="checkbox"
          aria-label={`Apply condition ${row.field || 'empty'}`}
          checked={row.enabled ?? true}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        On
      </label>
      <input
        aria-label="Condition field"
        value={row.field}
        onChange={(event) => onChange({ field: event.target.value })}
      />
      <select
        aria-label="Condition operator"
        value={row.operator}
        onChange={(event) => onChange({ operator: event.target.value as CqlConditionOperator })}
      >
        {OPERATORS.map((operator) => (
          <option key={operator.value} value={operator.value}>{operator.label}</option>
        ))}
      </select>
      <select
        aria-label="Condition value type"
        value={row.valueType}
        onChange={(event) => onChange({ valueType: event.target.value as CqlBuilderValueType })}
      >
        {VALUE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <input
        aria-label="Condition value"
        value={row.value}
        onChange={(event) => onChange({ value: event.target.value })}
      />
      <button
        type="button"
        className="query-builder-remove"
        aria-label={`Remove condition ${row.field || 'empty'}`}
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  )
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}
