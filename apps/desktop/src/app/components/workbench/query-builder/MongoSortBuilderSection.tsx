import { BuilderSection } from './BuilderSection'
import { TrashIcon } from '../icons'
import type { MongoFindSectionProps } from './MongoBuilderSection.types'
import { rowId } from './MongoBuilderSection.types'

export function MongoSortBuilderSection({
  dragActive,
  draft,
  filterGroups,
  updateDraft,
}: MongoFindSectionProps) {
  return (
    <BuilderSection
      title="Sort"
      actionLabel="Add Sort"
      dropHint="Drop a result field to order"
      dropZone="sort"
      dragActive={dragActive}
      onDropField={(field) =>
        updateDraft({
          filterGroups,
          sort: [...draft.sort, { id: rowId('sort'), field, direction: 'asc' }],
        })
      }
      onAdd={() =>
        updateDraft({
          filterGroups,
          sort: [...draft.sort, { id: rowId('sort'), field: '', direction: 'asc' }],
        })
      }
    >
      {draft.sort.length === 0 ? <p className="query-builder-empty">No sort.</p> : null}
      {draft.sort.map((row) => (
        <div className="query-builder-row query-builder-row--sort" key={row.id}>
          <input
            aria-label="Sort field"
            placeholder="field"
            value={row.field}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                sort: draft.sort.map((item) =>
                  item.id === row.id ? { ...item, field: event.target.value } : item,
                ),
              })
            }
          />
          <select
            aria-label="Sort direction"
            value={row.direction}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                sort: draft.sort.map((item) =>
                  item.id === row.id
                    ? { ...item, direction: event.target.value as 'asc' | 'desc' }
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
            className="query-builder-remove query-builder-remove--icon"
            aria-label="Remove sort"
            title="Remove sort"
            onClick={() =>
              updateDraft({
                filterGroups,
                sort: draft.sort.filter((item) => item.id !== row.id),
              })
            }
          >
            <TrashIcon className="toolbar-icon" />
          </button>
        </div>
      ))}
    </BuilderSection>
  )
}
