import type {
  SearchDslAggregationType,
  SearchDslBuilderState,
} from '@datapadplusplus/shared-types'
import { BuilderSection } from '../../../query-builder/BuilderSection'
import { searchDslBuilderRowId } from '../../../query-builder/search-dsl'

interface SearchAggregationSectionProps {
  draft: SearchDslBuilderState
  updateDraft(patch: Partial<SearchDslBuilderState>): void
}

const AGGREGATION_TYPES: SearchDslAggregationType[] = [
  'terms',
  'date-histogram',
  'histogram',
  'avg',
  'sum',
  'min',
  'max',
  'cardinality',
]

export function SearchAggregationSection({
  draft,
  updateDraft,
}: SearchAggregationSectionProps) {
  return (
    <BuilderSection
      title="Aggregations"
      actionLabel="Add Aggregation"
      dropHint="Drop a field to aggregate"
      onAdd={() =>
        updateDraft({
          aggregations: [
            ...draft.aggregations,
            { id: searchDslBuilderRowId('search-agg'), field: '', type: 'terms', size: 10 },
          ],
        })}
      onDropField={(field) =>
        updateDraft({
          aggregations: [
            ...draft.aggregations,
            { id: searchDslBuilderRowId('search-agg'), field, type: 'terms', size: 10 },
          ],
        })}
    >
      {draft.aggregations.length === 0 ? (
        <p className="query-builder-empty">No aggregations requested.</p>
      ) : draft.aggregations.map((agg) => (
        <div key={agg.id} className="query-builder-row query-builder-row--filter">
          <input
            aria-label="Aggregation field"
            value={agg.field}
            onChange={(event) =>
              updateDraft({
                aggregations: draft.aggregations.map((item) =>
                  item.id === agg.id ? { ...item, field: event.target.value } : item,
                ),
              })
            }
          />
          <select
            aria-label="Aggregation type"
            value={agg.type ?? 'terms'}
            onChange={(event) =>
              updateDraft({
                aggregations: draft.aggregations.map((item) =>
                  item.id === agg.id
                    ? { ...item, type: event.target.value as SearchDslAggregationType }
                    : item,
                ),
              })
            }
          >
            {AGGREGATION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <input
            aria-label="Aggregation name"
            value={agg.name ?? ''}
            placeholder="optional name"
            onChange={(event) =>
              updateDraft({
                aggregations: draft.aggregations.map((item) =>
                  item.id === agg.id ? { ...item, name: event.target.value } : item,
                ),
              })
            }
          />
          {(agg.type ?? 'terms') === 'terms' ? (
            <input
              aria-label="Aggregation size"
              type="number"
              min={1}
              value={agg.size ?? 10}
              onChange={(event) =>
                updateDraft({
                  aggregations: draft.aggregations.map((item) =>
                    item.id === agg.id
                      ? { ...item, size: numberValue(event.target.value, 10) }
                      : item,
                  ),
                })
              }
            />
          ) : null}
          {['date-histogram', 'histogram'].includes(agg.type ?? '') ? (
            <input
              aria-label="Aggregation interval"
              value={
                agg.interval ??
                ((agg.type ?? 'terms') === 'date-histogram' ? '1d' : '10')
              }
              onChange={(event) =>
                updateDraft({
                  aggregations: draft.aggregations.map((item) =>
                    item.id === agg.id ? { ...item, interval: event.target.value } : item,
                  ),
                })
              }
            />
          ) : null}
          <button
            type="button"
            className="query-builder-remove"
            aria-label={`Remove aggregation ${agg.field || 'empty'}`}
            onClick={() =>
              updateDraft({
                aggregations: draft.aggregations.filter((item) => item.id !== agg.id),
              })}
          >
            Remove
          </button>
        </div>
      ))}
    </BuilderSection>
  )
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}
