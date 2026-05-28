import type { ReactNode } from 'react'
import type { ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import {
  ObjectBucketIcon,
  ObjectCollectionIcon,
  ObjectColumnIcon,
  ObjectConstraintIcon,
  ObjectDatabaseIcon,
  ObjectDocumentIcon,
  ObjectFunctionIcon,
  ObjectGenericIcon,
  ObjectGraphIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectKeyIcon,
  ObjectMappingIcon,
  ObjectMetricIcon,
  ObjectPackageIcon,
  ObjectRelationshipIcon,
  ObjectRoleIcon,
  ObjectSchemaIcon,
  ObjectSearchIcon,
  ObjectSecurityIcon,
  ObjectServerIcon,
  ObjectStageIcon,
  ObjectStreamIcon,
  ObjectTableIcon,
  ObjectTriggerIcon,
  ObjectViewIcon,
  ObjectWarehouseIcon,
  RefreshIcon,
} from './icons'

export function ObjectViewHeader({
  children,
  connection,
  environment,
  kind,
  path,
  title,
  refreshing,
  onRefresh,
}: {
  children?: ReactNode
  connection: ConnectionProfile
  environment: EnvironmentProfile
  kind: string
  path?: string[]
  title: string
  refreshing: boolean
  onRefresh(): void
}) {
  return (
    <div className="object-view-toolbar">
      <div className="object-view-heading">
        <ObjectViewKindIcon kind={kind} />
        <div>
          <strong>{title}</strong>
          <span>
            {[connection.name, environment.label, ...(path ?? [])].filter(Boolean).join(' / ')}
          </span>
        </div>
      </div>
      <div className="object-view-actions">
        {children}
        <button
          type="button"
          className="drawer-button"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshIcon className="panel-inline-icon" />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

function ObjectViewKindIcon({ kind }: { kind: string }) {
  const normalized = kind.trim().toLowerCase().replace(/_/g, '-')

  return objectViewKindIcon(normalized)
}

function objectViewKindIcon(kind: string) {
  if (kind.includes('index')) return <ObjectIndexIcon className="panel-inline-icon" />
  if (kind.includes('column')) return <ObjectColumnIcon className="panel-inline-icon" />
  if (kind.includes('constraint') || kind.includes('foreign-key') || kind.includes('primary-key')) {
    return <ObjectConstraintIcon className="panel-inline-icon" />
  }
  if (kind.includes('procedure') || kind.includes('function')) return <ObjectFunctionIcon className="panel-inline-icon" />
  if (kind.includes('package') || kind.includes('type')) return <ObjectPackageIcon className="panel-inline-icon" />
  if (kind.includes('trigger')) return <ObjectTriggerIcon className="panel-inline-icon" />
  if (kind.includes('user') || kind.includes('role')) return <ObjectRoleIcon className="panel-inline-icon" />
  if (kind.includes('security') || kind.includes('permission') || kind.includes('grant') || kind.includes('acl')) {
    return <ObjectSecurityIcon className="panel-inline-icon" />
  }
  if (kind.includes('metric') || kind.includes('stat') || kind.includes('diagnostic') || kind.includes('performance')) {
    return <ObjectMetricIcon className="panel-inline-icon" />
  }
  if (kind.includes('collection')) return <ObjectCollectionIcon className="panel-inline-icon" />
  if (kind.includes('document') || kind.includes('validation') || kind.includes('schema-preview')) {
    return <ObjectDocumentIcon className="panel-inline-icon" />
  }
  if (kind.includes('view') || kind.includes('pipeline')) return <ObjectViewIcon className="panel-inline-icon" />
  if (kind.includes('mapping')) return <ObjectMappingIcon className="panel-inline-icon" />
  if (kind.includes('search')) return <ObjectSearchIcon className="panel-inline-icon" />
  if (kind.includes('stream')) return <ObjectStreamIcon className="panel-inline-icon" />
  if (kind.includes('key')) return <ObjectKeyIcon className="panel-inline-icon" />
  if (kind.includes('graph') || kind.includes('node')) return <ObjectGraphIcon className="panel-inline-icon" />
  if (kind.includes('edge') || kind.includes('relationship')) return <ObjectRelationshipIcon className="panel-inline-icon" />
  if (kind.includes('bucket') || kind.includes('gridfs') || kind.includes('file')) return <ObjectBucketIcon className="panel-inline-icon" />
  if (kind.includes('stage')) return <ObjectStageIcon className="panel-inline-icon" />
  if (kind.includes('warehouse')) return <ObjectWarehouseIcon className="panel-inline-icon" />
  if (kind.includes('server') || kind.includes('cluster') || kind.includes('sentinel')) return <ObjectServerIcon className="panel-inline-icon" />
  if (kind.includes('job') || kind.includes('script') || kind.includes('agent') || kind.includes('task')) return <ObjectJobIcon className="panel-inline-icon" />
  if (kind.includes('schema') || kind.includes('folder')) return <ObjectSchemaIcon className="panel-inline-icon" />
  if (kind.includes('table')) return <ObjectTableIcon className="panel-inline-icon" />
  if (kind.includes('database') || kind.includes('keyspace')) return <ObjectDatabaseIcon className="panel-inline-icon" />

  return <ObjectGenericIcon className="panel-inline-icon" />
}
