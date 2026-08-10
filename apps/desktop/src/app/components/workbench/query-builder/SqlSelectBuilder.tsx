import type {
  ConnectionProfile,
  QueryBuilderState,
  QueryTabState,
  SqlBuilderValueType,
  SqlSelectBuilderState,
  SqlSelectFilterOperator,
} from '@datapadplusplus/shared-types'
import { BuilderSection } from './BuilderSection'
import {
  sqlBuilderRowId,
} from './sql-select'
import { QueryBuilderValueInput } from './QueryBuilderValueInput'
import {
  queryBuilderOperatorArity,
  queryBuilderValueTypeLabel,
} from './query-value-codec'
import { builderStateWithCompiledQueryText } from '../../../controllers/query-builder-routing'

interface SqlSelectBuilderProps {
  connection: ConnectionProfile
  tab: QueryTabState
  builderState: SqlSelectBuilderState
  tableOptions?: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
  theme: string
}

const FILTER_OPERATORS: Array<{ value: SqlSelectFilterOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '<>' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'Contains' },
  { value: 'not-contains', label: 'Not Contains' },
  { value: 'starts-with', label: 'Starts with' },
  { value: 'not-starts-with', label: 'Does not start with' },
  { value: 'ends-with', label: 'Ends with' },
  { value: 'not-ends-with', label: 'Does not end with' },
  { value: 'like', label: 'LIKE' },
  { value: 'in', label: 'IN' },
  { value: 'not-in', label: 'NOT IN' },
  { value: 'is-null', label: 'IS NULL' },
  { value: 'is-not-null', label: 'IS NOT NULL' },
  { value: 'has-items', label: 'Has Items' },
  { value: 'has-no-items', label: 'Has No Items' },
  { value: 'has-length', label: 'Has Length' },
]

const VALUE_TYPES: SqlBuilderValueType[] = ['string', 'number', 'boolean', 'null', 'date', 'uuid']
const ARRAY_PREDICATE_ENGINES = new Set<ConnectionProfile['engine']>([
  'postgresql',
  'cockroachdb',
  'mysql',
  'mariadb',
  'sqlite',
  'sqlserver',
])

export function SqlSelectBuilder({
  connection,
  tab,
  builderState,
  tableOptions = [],
  onBuilderStateChange,
  theme,
}: SqlSelectBuilderProps) {
  const draft = builderState
  const resolvedTableOptions = uniqueValues([draft.table, ...tableOptions])
  const updateDraft = (patch: Partial<SqlSelectBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    const next = builderStateWithCompiledQueryText(nextDraft, connection, tab)

    onBuilderStateChange?.(tab.id, next)
  }

  return (
    <section className="query-builder-panel" aria-label="SQL SELECT builder">
      <div className="query-builder-grid query-builder-grid--sql-target">
        <label className="query-builder-field">
          <span>Schema</span>
          <input
            aria-label="Schema"
            value={draft.schema ?? ''}
            placeholder="optional"
            onChange={(event) => updateDraft({ schema: event.target.value })}
          />
        </label>
        <label className="query-builder-field">
          <span>Table</span>
          <input
            aria-label="Table"
            list="sql-builder-table-options"
            value={draft.table}
            onChange={(event) => updateDraft({ table: event.target.value })}
          />
          <datalist id="sql-builder-table-options">
            {resolvedTableOptions.map((table) => (
              <option key={table} value={table} />
            ))}
          </datalist>
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
      </div>

      <BuilderSection
        title="Columns"
        actionLabel="Add Column"
        dropHint="Drop a field to select it"
        onAdd={() =>
          updateDraft({
            projectionFields: [
              ...draft.projectionFields,
              { id: sqlBuilderRowId('projection'), field: '' },
            ],
          })
        }
        onDropField={(field) =>
          updateDraft({
            projectionFields: [
              ...draft.projectionFields,
              { id: sqlBuilderRowId('projection'), field },
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

      <BuilderSection
        title="Filters"
        actionLabel="Add Filter"
        dropHint="Drop a field to filter"
        onAdd={() =>
          updateDraft({
            filters: [...draft.filters, newFilterRow()],
          })
        }
        onDropField={(field) =>
          updateDraft({
            filters: [...draft.filters, { ...newFilterRow(), field }],
          })
        }
      >
        <label className="query-builder-inline-field">
          <span>Logic</span>
          <select
            aria-label="Filter logic"
            value={draft.filterLogic}
            onChange={(event) =>
              updateDraft({ filterLogic: event.target.value === 'or' ? 'or' : 'and' })
            }
          >
            <option value="and">AND</option>
            <option value="or">OR</option>
          </select>
        </label>
        {draft.filters.length === 0 ? (
          <p className="query-builder-empty">No filters applied.</p>
        ) : (
          draft.filters.map((filter) => {
            const arity = queryBuilderOperatorArity(filter.operator)
            return (
            <div
              key={filter.id}
              className={`query-builder-row query-builder-row--filter is-${arity}${filter.enabled === false ? ' is-disabled' : ''}`}
            >
              <label className="query-builder-toggle">
                <input
                  type="checkbox"
                  aria-label={`Apply filter ${filter.field || 'empty'}`}
                  checked={filter.enabled ?? true}
                  onChange={(event) =>
                    updateFilter(draft, updateDraft, filter.id, { enabled: event.target.checked })
                  }
                />
                On
              </label>
              <input
                aria-label="Filter field"
                value={filter.field}
                onChange={(event) =>
                  updateFilter(draft, updateDraft, filter.id, { field: event.target.value })
                }
              />
              <select
                aria-label="Filter operator"
                title={filter.operator.startsWith('has-') ? 'Native server-side array or JSON-array length predicate.' : undefined}
                value={filter.operator}
                onChange={(event) =>
                  updateFilter(draft, updateDraft, filter.id, {
                    operator: event.target.value as SqlSelectFilterOperator,
                  })
                }
              >
                {FILTER_OPERATORS.filter((operator) =>
                  !operator.value.startsWith('has-') || ARRAY_PREDICATE_ENGINES.has(connection.engine),
                ).map((operator) => (
                  <option key={operator.value} value={operator.value}>
                    {operator.label}
                  </option>
                ))}
              </select>
              {arity !== 'none' && arity !== 'length' ? <select
                aria-label="Filter value type"
                className="query-builder-value-type"
                value={filter.valueType}
                onChange={(event) =>
                  updateFilter(draft, updateDraft, filter.id, {
                    valueType: event.target.value as SqlBuilderValueType,
                  })
                }
              >
                {VALUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {queryBuilderValueTypeLabel(type)}
                  </option>
                ))}
              </select> : null}
              {arity !== 'none' ? <QueryBuilderValueInput
                ariaLabel="Filter value"
                operator={filter.operator}
                theme={theme}
                value={filter.value}
                valueType={arity === 'length' ? 'number' : filter.valueType}
                onChange={(value) =>
                  updateFilter(draft, updateDraft, filter.id, { value })
                }
              /> : null}
              <button
                type="button"
                className="query-builder-remove"
                aria-label={`Remove filter ${filter.field || 'empty'}`}
                onClick={() =>
                  updateDraft({
                    filters: draft.filters.filter((item) => item.id !== filter.id),
                  })
                }
              >
                Remove
              </button>
            </div>
            )
          })
        )}
      </BuilderSection>

      <BuilderSection
        title="Sort"
        actionLabel="Add Sort"
        dropHint="Drop a field to order"
        onAdd={() => updateDraft({ sort: [...draft.sort, newSortRow()] })}
        onDropField={(field) =>
          updateDraft({ sort: [...draft.sort, { ...newSortRow(), field }] })
        }
      >
        {draft.sort.length === 0 ? (
          <p className="query-builder-empty">No ordering applied.</p>
        ) : (
          draft.sort.map((sort) => (
            <div key={sort.id} className="query-builder-row query-builder-row--sort">
              <input
                aria-label="Sort field"
                value={sort.field}
                onChange={(event) =>
                  updateDraft({
                    sort: draft.sort.map((item) =>
                      item.id === sort.id ? { ...item, field: event.target.value } : item,
                    ),
                  })
                }
              />
              <select
                aria-label="Sort direction"
                value={sort.direction}
                onChange={(event) =>
                  updateDraft({
                    sort: draft.sort.map((item) =>
                      item.id === sort.id
                        ? { ...item, direction: event.target.value === 'desc' ? 'desc' : 'asc' }
                        : item,
                    ),
                  })
                }
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button
                type="button"
                className="query-builder-remove"
                aria-label={`Remove sort ${sort.field || 'empty'}`}
                onClick={() =>
                  updateDraft({ sort: draft.sort.filter((item) => item.id !== sort.id) })
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

function updateFilter(
  draft: SqlSelectBuilderState,
  updateDraft: (patch: Partial<SqlSelectBuilderState>) => void,
  id: string,
  patch: Partial<SqlSelectBuilderState['filters'][number]>,
) {
  updateDraft({
    filters: draft.filters.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  })
}

function newFilterRow(): SqlSelectBuilderState['filters'][number] {
  return {
    id: sqlBuilderRowId('filter'),
    enabled: true,
    field: '',
    operator: 'eq',
    value: '',
    valueType: 'string',
  }
}

function newSortRow(): SqlSelectBuilderState['sort'][number] {
  return {
    id: sqlBuilderRowId('sort'),
    field: '',
    direction: 'asc',
  }
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}
