import type {
  ConnectionProfile,
  MongoAggregationBuilderState,
  MongoAggregationStageRow,
  QueryBuilderState,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import type { DragEvent, PointerEvent } from 'react'
import { useRef } from 'react'
import { BuilderSection } from '../../query-builder/BuilderSection'
import { buildMongoAggregationQueryText } from '../../query-builder/mongo-aggregation'
import { mongoQueryScopeForTab } from '../../query-builder/mongo-query-scope'
import { MongoScopeSummary } from './MongoScopeSummary'
import {
  acceptMongoBuilderRowDrag,
  acceptMongoBuilderRowPointerDrop,
  clearMongoBuilderRowDrag,
  mongoBuilderPointerTarget,
} from './MongoBuilderRowDrag.helpers'
import { MongoBuilderDragHandle } from './MongoBuilderRowDrag'

const STAGE_OPTIONS = [
  '$match',
  '$project',
  '$sort',
  '$group',
  '$lookup',
  '$unwind',
  '$limit',
  '$skip',
  '$addFields',
  '$count',
]

interface MongoAggregationBuilderProps {
  connection?: ConnectionProfile
  tab: QueryTabState
  builderState: MongoAggregationBuilderState
  collectionOptions: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
}

export function MongoAggregationBuilder({
  connection,
  tab,
  builderState,
  collectionOptions,
  onBuilderStateChange,
}: MongoAggregationBuilderProps) {
  const draft = builderState
  const resolvedCollectionOptions = Array.from(
    new Set([draft.collection, ...collectionOptions].map((item) => item.trim()).filter(Boolean)),
  )
  const scope = mongoQueryScopeForTab({
    builderState: draft,
    connection,
    tab,
  })
  const stageIdCounter = useRef(draft.stages.length)

  const updateDraft = (patch: Partial<MongoAggregationBuilderState>) => {
    const nextDraft = {
      ...draft,
      ...(scope?.database ? { database: scope.database } : {}),
      ...patch,
    }
    onBuilderStateChange?.(tab.id, {
      ...nextDraft,
      lastAppliedQueryText: buildMongoAggregationQueryText(nextDraft, {
        database: scope?.database,
      }),
    })
  }

  const updateStage = (stageId: string, patch: Partial<MongoAggregationStageRow>) => {
    updateDraft({
      stages: draft.stages.map((stage) =>
        stage.id === stageId ? { ...stage, ...patch } : stage,
      ),
    })
  }

  const moveStage = (stageId: string, direction: -1 | 1) => {
    const index = draft.stages.findIndex((stage) => stage.id === stageId)
    const targetIndex = index + direction

    if (index < 0 || targetIndex < 0 || targetIndex >= draft.stages.length) {
      return
    }

    const stages = [...draft.stages]
    const [stage] = stages.splice(index, 1)
    if (stage) {
      stages.splice(targetIndex, 0, stage)
      updateDraft({ stages })
    }
  }

  const moveStageTo = (
    stageId: string,
    targetStageId: string,
    placement: RowDropPlacement,
  ) => {
    updateDraft({
      stages: moveRow(draft.stages, stageId, targetStageId, placement),
    })
  }

  const removeStage = (stageId: string) => {
    updateDraft({ stages: draft.stages.filter((stage) => stage.id !== stageId) })
  }

  const addStage = () => {
    stageIdCounter.current += 1
    updateDraft({
      stages: [
        ...draft.stages,
        {
          id: `stage-${stageIdCounter.current}`,
          enabled: true,
          stage: '$match',
          body: '{}',
        },
      ],
    })
  }

  return (
    <section className="query-builder-panel" aria-label="MongoDB aggregation builder">
      <MongoScopeSummary scope={scope} />
      <div className="query-builder-grid">
        <label className="query-builder-field">
          <span>Collection</span>
          <select
            aria-label="Collection"
            value={draft.collection}
            onChange={(event) => updateDraft({ collection: event.target.value })}
          >
            {resolvedCollectionOptions.length === 0 ? (
              <option value="">Select collection</option>
            ) : null}
            {resolvedCollectionOptions.map((collection) => (
              <option key={collection} value={collection}>
                {collection}
              </option>
            ))}
          </select>
        </label>
        <label className="query-builder-field query-builder-field--number">
          <span>Fetch size</span>
          <input
            aria-label="Fetch size"
            min={1}
            type="number"
            value={draft.limit ?? 20}
            onChange={(event) => updateDraft({ limit: positiveInteger(event.target.value, 20) })}
          />
        </label>
      </div>

      <BuilderSection
        actionLabel="Add Stage"
        title="Pipeline"
        dropHint="Stages run top to bottom"
        onAdd={addStage}
      >
        {draft.stages.length === 0 ? (
          <p className="query-builder-empty">No stages.</p>
        ) : (
          <div className="query-builder-rows">
            {draft.stages.map((stage, index) => (
              <div
                className="query-builder-row query-builder-row--wide query-builder-row--draggable"
                data-mongo-builder-row-kind="stage"
                data-mongo-builder-row-id={stage.id}
                key={stage.id}
                onDragOverCapture={(event) => {
                  if (acceptMongoBuilderRowDrag(event, 'stage')) {
                    event.stopPropagation()
                  }
                }}
                onDropCapture={(event) => {
                  const payload = acceptMongoBuilderRowDrag(event, 'stage')

                  if (!payload) {
                    return
                  }

                  event.stopPropagation()
                  moveStageTo(payload.rowId, stage.id, rowDropPlacement(event))
                  clearMongoBuilderRowDrag()
                }}
                onPointerUpCapture={(event) => {
                  const payload = acceptMongoBuilderRowPointerDrop(event, 'stage')

                  if (!payload) {
                    return
                  }

                  const targetRow = mongoBuilderCompatibleRowElement(
                    mongoBuilderPointerTarget(event),
                    'stage',
                  )
                  const targetRowId = targetRow?.dataset.mongoBuilderRowId

                  if (!targetRowId) {
                    clearMongoBuilderRowDrag()
                    return
                  }

                  event.stopPropagation()
                  moveStageTo(payload.rowId, targetRowId, rowPointerDropPlacement(event, targetRow))
                  clearMongoBuilderRowDrag()
                }}
              >
                <MongoBuilderDragHandle
                  kind="stage"
                  label={`Drag stage ${index + 1}`}
                  rowId={stage.id}
                />
                <label className="query-builder-toggle">
                  <input
                    aria-label={`Apply stage ${index + 1}`}
                    checked={stage.enabled ?? true}
                    type="checkbox"
                    onChange={(event) => updateStage(stage.id, { enabled: event.target.checked })}
                  />
                  <span>On</span>
                </label>
                <select
                  aria-label="Aggregation stage"
                  value={stage.stage}
                  onChange={(event) => updateStage(stage.id, { stage: event.target.value })}
                >
                  {STAGE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <textarea
                  aria-label={`${stage.stage} stage body`}
                  rows={3}
                  value={stage.body}
                  onChange={(event) => updateStage(stage.id, { body: event.target.value })}
                />
                <div className="query-builder-row-actions">
                  <button type="button" className="drawer-button" onClick={() => moveStage(stage.id, -1)}>
                    Up
                  </button>
                  <button type="button" className="drawer-button" onClick={() => moveStage(stage.id, 1)}>
                    Down
                  </button>
                  <button type="button" className="drawer-button" onClick={() => removeStage(stage.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </BuilderSection>
    </section>
  )
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

type RowDropPlacement = 'before' | 'after'

function moveRow<T extends { id: string }>(
  rows: T[],
  rowId: string,
  targetRowId: string,
  placement: RowDropPlacement,
) {
  const moving = rows.find((row) => row.id === rowId)

  if (!moving || rowId === targetRowId) {
    return rows
  }

  const withoutMoving = rows.filter((row) => row.id !== rowId)
  const targetIndex = withoutMoving.findIndex((row) => row.id === targetRowId)

  if (targetIndex < 0) {
    return [...withoutMoving, moving]
  }

  const next = [...withoutMoving]
  next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, moving)
  return next
}

function rowDropPlacement(event: DragEvent<HTMLElement>): RowDropPlacement {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
}

function rowPointerDropPlacement(event: PointerEvent<HTMLElement>, element = event.currentTarget): RowDropPlacement {
  const rect = element.getBoundingClientRect()
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
}

function mongoBuilderCompatibleRowElement(target: HTMLElement | undefined, kind: string) {
  const row = target?.closest<HTMLElement>('[data-mongo-builder-row-id]')
  return row?.dataset.mongoBuilderRowKind === kind ? row : undefined
}
