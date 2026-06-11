import type {
  DynamoDbBuilderValueType,
  DynamoDbConditionOperator,
  DynamoDbConditionRow,
  DynamoDbKeyConditionBuilderState,
  QueryBuilderState,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { BuilderSection } from '../../query-builder/BuilderSection'
import {
  buildDynamoDbKeyConditionQueryText,
  dynamoDbBuilderRowId,
  newDynamoDbCondition,
} from '../../query-builder/dynamodb-key-condition'

interface DynamoDbKeyConditionBuilderProps {
  tab: QueryTabState
  builderState: DynamoDbKeyConditionBuilderState
  tableOptions?: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
}

const KEY_OPERATORS: Array<{ value: DynamoDbConditionOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'between', label: 'BETWEEN' },
  { value: 'begins-with', label: 'BEGINS WITH' },
]

const FILTER_OPERATORS: Array<{ value: DynamoDbConditionOperator; label: string }> = [
  ...KEY_OPERATORS,
  { value: 'ne', label: '<>' },
  { value: 'contains', label: 'CONTAINS' },
  { value: 'exists', label: 'EXISTS' },
]

const VALUE_TYPES: DynamoDbBuilderValueType[] = ['string', 'number', 'boolean', 'null', 'json']

export function DynamoDbKeyConditionBuilder({
  tab,
  builderState,
  tableOptions = [],
  onBuilderStateChange,
}: DynamoDbKeyConditionBuilderProps) {
  const draft = builderState
  const resolvedTableOptions = uniqueValues([draft.table, ...tableOptions])
  const updateDraft = (patch: Partial<DynamoDbKeyConditionBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    const next = {
      ...nextDraft,
      lastAppliedQueryText: buildDynamoDbKeyConditionQueryText(nextDraft),
    }

    onBuilderStateChange?.(tab.id, next)
  }

  return (
    <section className="query-builder-panel" aria-label="DynamoDB key-condition builder">
      <div className="query-builder-grid query-builder-grid--sql-target">
        <label className="query-builder-field">
          <span>Table</span>
          <select
            aria-label="Table"
            value={draft.table}
            onChange={(event) => updateDraft({ table: event.target.value })}
          >
            {resolvedTableOptions.length === 0 ? <option value="">Select table</option> : null}
            {resolvedTableOptions.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>
        </label>
        <label className="query-builder-field">
          <span>Index</span>
          <input
            aria-label="Index"
            value={draft.indexName ?? ''}
            placeholder="optional GSI/LSI"
            onChange={(event) => updateDraft({ indexName: event.target.value })}
          />
        </label>
        <label className="query-builder-field">
          <span>Limit</span>
          <input
            aria-label="Limit"
            type="number"
            min={1}
            value={draft.limit ?? 20}
            onChange={(event) => updateDraft({ limit: numberValue(event.target.value, 20) })}
          />
        </label>
        <label className="query-builder-toggle query-builder-toggle--inline">
          <input
            type="checkbox"
            aria-label="Consistent read"
            checked={Boolean(draft.consistentRead)}
            onChange={(event) => updateDraft({ consistentRead: event.target.checked })}
          />
          Consistent
        </label>
      </div>

      <BuilderSection
        title="Key Condition"
        actionLabel={draft.sortKey ? 'Clear Sort Key' : 'Add Sort Key'}
        dropHint="Drop fields for partition/sort keys"
        onAdd={() =>
          updateDraft({
            sortKey: draft.sortKey ? undefined : newDynamoDbCondition('', 'begins-with'),
          })
        }
        onDropField={(field) =>
          draft.partitionKey.field
            ? updateDraft({ sortKey: { ...(draft.sortKey ?? newDynamoDbCondition('', 'begins-with')), field } })
            : updateDraft({ partitionKey: { ...draft.partitionKey, field } })
        }
      >
        <ConditionRow
          label="Partition key"
          row={{ ...draft.partitionKey, operator: 'eq' }}
          operatorOptions={[{ value: 'eq', label: '=' }]}
          onChange={(patch) => updateDraft({ partitionKey: { ...draft.partitionKey, ...patch, operator: 'eq' } })}
        />
        {draft.sortKey ? (
          <ConditionRow
            label="Sort key"
            row={draft.sortKey}
            operatorOptions={KEY_OPERATORS}
            onChange={(patch) => updateDraft({ sortKey: { ...draft.sortKey!, ...patch } })}
          />
        ) : null}
      </BuilderSection>

      <BuilderSection
        title="Filters"
        actionLabel="Add Filter"
        dropHint="Drop a field to filter"
        onAdd={() => updateDraft({ filters: [...draft.filters, newDynamoDbCondition()] })}
        onDropField={(field) =>
          updateDraft({ filters: [...draft.filters, { ...newDynamoDbCondition(), field }] })
        }
      >
        {draft.filters.length === 0 ? (
          <p className="query-builder-empty">No post-key filters applied.</p>
        ) : (
          draft.filters.map((filter) => (
            <ConditionRow
              key={filter.id}
              label="Filter"
              row={filter}
              operatorOptions={FILTER_OPERATORS}
              removable
              onChange={(patch) =>
                updateDraft({
                  filters: draft.filters.map((item) =>
                    item.id === filter.id ? { ...item, ...patch } : item,
                  ),
                })
              }
              onRemove={() =>
                updateDraft({ filters: draft.filters.filter((item) => item.id !== filter.id) })
              }
            />
          ))
        )}
      </BuilderSection>

      <BuilderSection
        title="Projection"
        actionLabel="Add Field"
        dropHint="Drop a field to return"
        onAdd={() =>
          updateDraft({
            projectionFields: [
              ...draft.projectionFields,
              { id: dynamoDbBuilderRowId('ddb-projection'), field: '' },
            ],
          })
        }
        onDropField={(field) =>
          updateDraft({
            projectionFields: [
              ...draft.projectionFields,
              { id: dynamoDbBuilderRowId('ddb-projection'), field },
            ],
          })
        }
      >
        {draft.projectionFields.length === 0 ? (
          <p className="query-builder-empty">Returning all projected attributes.</p>
        ) : (
          draft.projectionFields.map((field) => (
            <div key={field.id} className="query-builder-row query-builder-row--simple">
              <input
                aria-label="Projection field"
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
                aria-label={`Remove projection ${field.field || 'empty'}`}
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

function ConditionRow({
  label,
  operatorOptions,
  removable,
  row,
  onChange,
  onRemove,
}: {
  label: string
  operatorOptions: Array<{ value: DynamoDbConditionOperator; label: string }>
  removable?: boolean
  row: DynamoDbConditionRow
  onChange(patch: Partial<DynamoDbConditionRow>): void
  onRemove?(): void
}) {
  return (
    <div className={`query-builder-row query-builder-row--filter${row.enabled === false ? ' is-disabled' : ''}`}>
      {removable ? (
        <label className="query-builder-toggle">
          <input
            type="checkbox"
            aria-label={`Apply ${label.toLowerCase()} ${row.field || 'empty'}`}
            checked={row.enabled ?? true}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          On
        </label>
      ) : <span className="query-builder-row-label">{label}</span>}
      <input
        aria-label={`${label} field`}
        value={row.field}
        placeholder={label === 'Partition key' ? 'pk' : 'field'}
        onChange={(event) => onChange({ field: event.target.value })}
      />
      <select
        aria-label={`${label} operator`}
        value={row.operator}
        onChange={(event) => onChange({ operator: event.target.value as DynamoDbConditionOperator })}
      >
        {operatorOptions.map((operator) => (
          <option key={operator.value} value={operator.value}>{operator.label}</option>
        ))}
      </select>
      <select
        aria-label={`${label} value type`}
        value={row.valueType}
        onChange={(event) => onChange({ valueType: event.target.value as DynamoDbBuilderValueType })}
      >
        {VALUE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <input
        aria-label={`${label} value`}
        value={row.value}
        disabled={row.operator === 'exists'}
        onChange={(event) => onChange({ value: event.target.value })}
      />
      {row.operator === 'between' ? (
        <input
          aria-label={`${label} second value`}
          value={row.secondValue ?? ''}
          onChange={(event) => onChange({ secondValue: event.target.value })}
        />
      ) : null}
      {removable ? (
        <button
          type="button"
          className="query-builder-remove"
          aria-label={`Remove ${label.toLowerCase()} ${row.field || 'empty'}`}
          onClick={onRemove}
        >
          Remove
        </button>
      ) : null}
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
