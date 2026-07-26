import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import { PlayIcon } from '../../icons'
import { PurposeEmptyState } from '../../ObjectViewPrimitives'
import { mongoPipelineStageRows } from './MongoPipelineView.helpers'
import { stringValue } from './MongoOverviewView.helpers'
import {
  MongoContextStrip,
  MongoResourceSection,
} from './MongoOperationalViewPrimitives'
import type { MongoOverviewPayload } from './MongoOverviewView.types'

export function MongoViewOverview({
  payload,
  queryTarget,
  onOpenQuery,
  queryLabel,
}: {
  payload: MongoOverviewPayload
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
  queryLabel: string
}) {
  const pipeline = Array.isArray(payload.pipeline) ? payload.pipeline : []
  const database = stringValue(payload.database)
  const view = stringValue(payload.view)
  const backingCollection = stringValue(payload.backingCollection)

  return (
    <>
      <MongoContextStrip
        eyebrow="Read-only view"
        title={[database, view].filter(Boolean).join(' / ') || 'MongoDB view'}
        detail={backingCollection ? `Backed by ${backingCollection}` : 'Backing collection was not reported.'}
        metrics={[{ label: 'Pipeline stages', value: pipeline.length }]}
      />
      <MongoResourceSection
        eyebrow="View definition"
        title="Pipeline"
        description="Stages are shown in execution order."
        actions={queryTarget ? (
          <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
            <PlayIcon className="panel-inline-icon" />
            {queryLabel}
          </button>
        ) : null}
      >
        {pipeline.length ? (
          <div className="mongo-pipeline-stage-list" role="group" aria-label="MongoDB object pipeline stages">
            {mongoPipelineStageRows(pipeline).map((stage, index) => (
              <article className="mongo-pipeline-stage" key={`${stage.operator}:${index}`}>
                <div className="mongo-pipeline-stage-order">{index + 1}</div>
                <div className="mongo-pipeline-stage-body">
                  <div className="mongo-pipeline-stage-title">
                    <strong>{stage.operator}</strong>
                    <span>{stage.summary}</span>
                  </div>
                  {stage.details.length ? (
                    <div className="mongo-pipeline-stage-tags">
                      {stage.details.map((detail) => <span key={detail}>{detail}</span>)}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <PurposeEmptyState descriptor={{
            emptyTitle: 'No view pipeline metadata',
            emptyDescription: 'Refresh this view or check that the selected MongoDB view still exists.',
          }} />
        )}
      </MongoResourceSection>
    </>
  )
}
