import type { MongoFindBuilderState } from '@datapadplusplus/shared-types'
import { BuilderSection } from './BuilderSection'
import { TrashIcon } from '../icons'
import type { MongoFindSectionProps } from './MongoBuilderSection.types'
import { rowId } from './MongoBuilderSection.types'

export function MongoProjectionBuilderSection({
  dragActive,
  draft,
  filterGroups,
  updateDraft,
}: MongoFindSectionProps) {
  return (
    <BuilderSection
      title="Projection"
      actionLabel="Add Field"
      dropHint="Drop a result field to project"
      dropZone="projection"
      dragActive={dragActive}
      onDropField={(field) =>
        updateDraft({
          filterGroups,
          projectionMode: draft.projectionMode === 'all' ? 'include' : draft.projectionMode,
          projectionFields: [...draft.projectionFields, { id: rowId('projection'), field }],
        })
      }
      onAdd={() =>
        updateDraft({
          filterGroups,
          projectionMode: draft.projectionMode === 'all' ? 'include' : draft.projectionMode,
          projectionFields: [...draft.projectionFields, { id: rowId('projection'), field: '' }],
        })
      }
    >
      {draft.projectionFields.length === 0 ? (
        <p className="query-builder-empty">All fields.</p>
      ) : null}
      {draft.projectionFields.map((field) => (
        <div className="query-builder-row query-builder-row--projection" key={field.id}>
          <input
            aria-label="Projection field"
            placeholder="field"
            value={field.field}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                projectionFields: draft.projectionFields.map((item) =>
                  item.id === field.id ? { ...item, field: event.target.value } : item,
                ),
              })
            }
          />
          <select
            aria-label={`Projection mode ${field.field || field.id}`}
            value={draft.projectionMode === 'all' ? 'include' : draft.projectionMode}
            onChange={(event) =>
              updateDraft({
                filterGroups,
                projectionMode: event.target.value as MongoFindBuilderState['projectionMode'],
              })
            }
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
          </select>
          <button
            type="button"
            className="query-builder-remove query-builder-remove--icon"
            aria-label="Remove projection field"
            title="Remove projection field"
            onClick={() =>
              updateDraft({
                filterGroups,
                projectionFields: draft.projectionFields.filter((item) => item.id !== field.id),
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
