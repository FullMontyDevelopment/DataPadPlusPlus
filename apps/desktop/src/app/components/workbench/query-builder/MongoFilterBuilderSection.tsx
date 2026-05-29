import type { MongoBuilderValueType, MongoFindFilterGroup, MongoFindFilterRow, MongoFilterOperator } from '@datapadplusplus/shared-types'
import { BuilderSection } from './BuilderSection'
import { TrashIcon } from '../icons'
import type { MongoFindSectionProps } from './MongoBuilderSection.types'
import { rowId } from './MongoBuilderSection.types'
import { defaultFilterGroup } from './mongo-find-defaults'
import { mongoFilterRow, mongoFilterRowFromDroppedField } from './mongo-filter-row'

const FILTER_OPERATORS: Array<{ value: MongoFilterOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'Contains' },
  { value: 'regex', label: 'Regex' },
  { value: 'exists', label: 'Exists' },
  { value: 'in', label: 'In' },
]

const VALUE_TYPES: Array<{ value: MongoBuilderValueType; label: string }> = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'Date' },
  { value: 'objectId', label: 'ObjectId' },
  { value: 'null', label: 'null' },
  { value: 'json', label: 'json' },
]

export function MongoFilterBuilderSection({
  dragActive,
  draft,
  filterGroups,
  updateDraft,
}: MongoFindSectionProps) {
  const hasExplicitGroups = filterGroups.length > 0

  return (
    <BuilderSection
      title="Filters"
      actionLabel="Add Group"
      dropHint="Drop a result field to filter"
      dropZone="filters"
      dragActive={dragActive}
      secondaryActionLabel="Add Filter"
      onDropField={(field, payload) =>
        updateDraft({
          filterGroups,
          filters: [
            ...draft.filters,
            mongoFilterRowFromDroppedField(
              hasExplicitGroups ? filterGroups[0]?.id : undefined,
              field,
              payload,
            ),
          ],
        })
      }
      onSecondaryAdd={() =>
        updateDraft({
          filterGroups,
          filters: [
            ...draft.filters,
            mongoFilterRow(hasExplicitGroups ? filterGroups[0]?.id : undefined),
          ],
        })
      }
      onAdd={() =>
        updateDraft({
          filterGroups: [
            ...filterGroups,
            filterGroups.length === 0
              ? defaultFilterGroup()
              : {
                  id: rowId('filter-group'),
                  label: `Group ${filterGroups.length + 1}`,
                  logic: 'and',
                },
          ],
        })
      }
    >
      {draft.filters.length === 0 ? <p className="query-builder-empty">No filters.</p> : null}
      {!hasExplicitGroups && draft.filters.length > 0 ? (
        <FilterRows
          draft={draft}
          filterGroups={filterGroups}
          rows={draft.filters}
          updateDraft={updateDraft}
        />
      ) : null}
      {filterGroups.map((group) => (
        <FilterGroup
          draft={draft}
          filterGroups={filterGroups}
          group={group}
          key={group.id}
          updateDraft={updateDraft}
        />
      ))}
    </BuilderSection>
  )
}

function FilterGroup({
  draft,
  filterGroups,
  group,
  updateDraft,
}: MongoFindSectionProps & { group: MongoFindFilterGroup }) {
  const rows = draft.filters.filter((row) => (row.groupId ?? filterGroups[0]?.id) === group.id)

  return (
    <div className="query-builder-filter-group">
      <div className="query-builder-filter-group-header">
        <strong>{group.label}</strong>
        <label>
          <span>Match</span>
          <select
            aria-label={`Filter group logic ${group.label}`}
            value={group.logic}
            onChange={(event) =>
              updateDraft({
                filterGroups: filterGroups.map((item) =>
                  item.id === group.id
                    ? { ...item, logic: event.target.value as MongoFindFilterGroup['logic'] }
                    : item,
                ),
              })
            }
          >
            <option value="and">All (AND)</option>
            <option value="or">Any (OR)</option>
          </select>
        </label>
        <button
          type="button"
          className="drawer-button"
          onClick={() =>
            updateDraft({
              filterGroups,
              filters: [...draft.filters, mongoFilterRow(group.id)],
            })
          }
        >
          Add Filter
        </button>
        {filterGroups.length > 1 ? (
          <button
            type="button"
            className="query-builder-remove query-builder-remove--icon"
            aria-label={`Remove ${group.label}`}
            title={`Remove ${group.label}`}
            onClick={() =>
              updateDraft({
                filterGroups: filterGroups.filter((item) => item.id !== group.id),
                filters: draft.filters.filter(
                  (row) => (row.groupId ?? filterGroups[0]?.id) !== group.id,
                ),
              })
            }
          >
            <TrashIcon className="toolbar-icon" />
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? <p className="query-builder-empty">No filters in this group.</p> : null}
      <FilterRows
        draft={draft}
        filterGroups={filterGroups}
        rows={rows}
        updateDraft={updateDraft}
      />
    </div>
  )
}

function FilterRows({
  draft,
  filterGroups,
  rows,
  updateDraft,
}: MongoFindSectionProps & { rows: MongoFindFilterRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <div
          className={`query-builder-row query-builder-row--filter${
            row.enabled === false ? ' is-disabled' : ''
          }`}
          key={row.id}
        >
          <label className="query-builder-toggle">
            <input
              aria-label={`Apply filter ${row.field || row.id}`}
              title={row.enabled === false ? 'Enable filter' : 'Disable filter'}
              type="checkbox"
              checked={row.enabled ?? true}
              onChange={(event) =>
                updateDraft({
                  filterGroups,
                  filters: draft.filters.map((item) =>
                    item.id === row.id ? { ...item, enabled: event.target.checked } : item,
                  ),
                })
              }
            />
          </label>
          <input
            aria-label="Filter field"
            placeholder="field"
            value={row.field}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                filters: draft.filters.map((item) =>
                  item.id === row.id ? { ...item, field: event.target.value } : item,
                ),
              })
            }
          />
          <select
            aria-label="Filter operator"
            value={row.operator}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                filters: draft.filters.map((item) =>
                  item.id === row.id
                    ? { ...item, operator: event.target.value as MongoFilterOperator }
                    : item,
                ),
              })
            }
          >
            {FILTER_OPERATORS.map((operator) => (
              <option key={operator.value} value={operator.value}>
                {operator.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Value type"
            value={row.valueType}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                filters: draft.filters.map((item) =>
                  item.id === row.id
                    ? { ...item, valueType: event.target.value as MongoBuilderValueType }
                    : item,
                ),
              })
            }
          >
            {VALUE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Filter value"
            placeholder={row.operator === 'exists' ? 'true' : 'value'}
            value={row.value}
            disabled={row.valueType === 'null'}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                filters: draft.filters.map((item) =>
                  item.id === row.id ? { ...item, value: event.target.value } : item,
                ),
              })
            }
          />
          <button
            type="button"
            className="query-builder-remove query-builder-remove--icon"
            aria-label="Remove filter"
            title="Remove filter"
            onClick={() =>
              updateDraft({
                filterGroups,
                filters: draft.filters.filter((item) => item.id !== row.id),
              })
            }
          >
            <TrashIcon className="toolbar-icon" />
          </button>
        </div>
      ))}
    </>
  )
}
