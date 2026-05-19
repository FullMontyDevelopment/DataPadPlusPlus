import type {
  MongoAggregationBuilderState,
  MongoAggregationStageRow,
  QueryBuilderState,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { BuilderSection } from './BuilderSection'
import { buildMongoAggregationQueryText } from './mongo-aggregation'

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
  tab: QueryTabState
  builderState: MongoAggregationBuilderState
  collectionOptions: string[]
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
}

export function MongoAggregationBuilder({
  tab,
  builderState,
  collectionOptions,
  onBuilderStateChange,
}: MongoAggregationBuilderProps) {
  const draft = builderState
  const resolvedCollectionOptions = Array.from(
    new Set([draft.collection, ...collectionOptions].map((item) => item.trim()).filter(Boolean)),
  )

  const updateDraft = (patch: Partial<MongoAggregationBuilderState>) => {
    const nextDraft = { ...draft, ...patch }
    onBuilderStateChange?.(tab.id, {
      ...nextDraft,
      lastAppliedQueryText: buildMongoAggregationQueryText(nextDraft),
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

  const removeStage = (stageId: string) => {
    updateDraft({ stages: draft.stages.filter((stage) => stage.id !== stageId) })
  }

  const addStage = () => {
    updateDraft({
      stages: [
        ...draft.stages,
        {
          id: `stage-${Date.now().toString(36)}`,
          enabled: true,
          stage: '$match',
          body: '{}',
        },
      ],
    })
  }

  return (
    <section className="query-builder-panel" aria-label="MongoDB aggregation builder">
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
              <div className="query-builder-row query-builder-row--wide" key={stage.id}>
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
