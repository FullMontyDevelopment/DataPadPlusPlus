import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import { MongoCollectionOverview } from './MongoCollectionOverview'
import {
  MongoDatabaseOverview,
  MongoDatabasesOverview,
} from './MongoDatabaseOverviewViews'
import {
  mongoScopedQueryMenuLabel,
  type MongoObjectViewDescriptor,
} from './MongoObjectViewDescriptors'
import type {
  MongoOperationPlanner,
  MongoOverviewPayload,
  MongoOverviewToolKind,
} from './MongoOverviewView.types'
import { MongoViewOverview } from './MongoViewOverview'

export function MongoOverviewView({
  kind,
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
  onPlanOperation,
  onOpenToolView,
}: {
  kind: string
  descriptor: MongoObjectViewDescriptor
  payload: MongoOverviewPayload
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: MongoOperationPlanner
  onOpenToolView?(toolKind: MongoOverviewToolKind, label: string): void
}) {
  return (
    <div className="object-view-section">
      {kind === 'databases' || kind === 'system-databases' ? (
        <MongoDatabasesOverview
          payload={payload}
          readOnly={kind === 'system-databases'}
          onPlanOperation={onPlanOperation}
        />
      ) : null}
      {kind === 'database' ? (
        <MongoDatabaseOverview
          payload={payload}
          onPlanOperation={onPlanOperation}
        />
      ) : null}
      {kind === 'collection' ? (
        <MongoCollectionOverview
          payload={payload}
          onPlanOperation={onPlanOperation}
          onOpenToolView={onOpenToolView}
        />
      ) : null}
      {kind === 'view' ? (
        <MongoViewOverview
          payload={payload}
          queryTarget={queryTarget}
          onOpenQuery={onOpenQuery}
          queryLabel={descriptor.primaryQueryLabel ?? mongoScopedQueryMenuLabel(kind)}
        />
      ) : null}
    </div>
  )
}
