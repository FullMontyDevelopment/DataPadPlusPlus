import { useState } from 'react'
import { DownloadIcon, PlusIcon } from '../../icons'
import { ObjectViewTable } from '../../ObjectViewPrimitives'
import {
  MongoCollectionOperationDialog,
} from './MongoCollectionOperationDialog'
import {
  mongoCollectionAdminActions,
  mongoCollectionAdminOperationFromNodeId,
  type MongoCollectionAdminOperation,
} from './MongoCollectionOperations'
import {
  arrayOfRecords,
  asRecord,
  documentFieldSummary,
  formatBytes,
  indexKeyPatternText,
  indexOptionsSummary,
  normalizeIndexList,
  numericValue,
  stringValue,
} from './MongoOverviewView.helpers'
import {
  MongoContextStrip,
  MongoGuardedSection,
  MongoResourceSection,
} from './MongoOperationalViewPrimitives'
import type {
  MongoOperationPlanner,
  MongoOverviewPayload,
  MongoOverviewToolKind,
} from './MongoOverviewView.types'

export function MongoCollectionOverview({
  payload,
  onPlanOperation,
  onOpenToolView,
}: {
  payload: MongoOverviewPayload
  onPlanOperation?: MongoOperationPlanner
  onOpenToolView?(toolKind: MongoOverviewToolKind, label: string): void
}) {
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const initialAdminOperation = mongoCollectionAdminOperationFromNodeId(
    stringValue(payload.nodeId),
  )
  const indexes = normalizeIndexList(payload.indexes)
  const sampleDocuments = arrayOfRecords(payload.sampleDocuments)
  const validator = payload.validator ?? asRecord(payload.options)?.validator
  const statistics = asRecord(payload.statistics ?? payload.stats)
  const [activeAdminOperation, setActiveAdminOperation] =
    useResettableState<MongoCollectionAdminOperation | undefined>(initialAdminOperation)
  const [managementError, setManagementError] = useState('')
  const requireCollection = (setDialogError?: (message: string) => void) => {
    if (!database || !collection) {
      const message = 'A database and collection are required.'
      if (setDialogError) {
        setDialogError(message)
      } else {
        setManagementError(message)
      }
      return false
    }
    return true
  }
  const planCollectionManagement = (
    title: string,
    operationId: string,
    extraParameters: Record<string, unknown> = {},
    setDialogError?: (message: string) => void,
  ) => {
    if (!requireCollection(setDialogError)) {
      return
    }
    setManagementError('')
    setActiveAdminOperation(undefined)
    onPlanOperation?.({
      title,
      operationId,
      objectName: collection,
      parameters: {
        database,
        collection,
        ...extraParameters,
      },
    })
  }
  const planExport = () => {
    onPlanOperation?.({
      title: `Export ${collection}`,
      operationId: 'mongodb.collection.export',
      objectName: collection,
      parameters: {
        database,
        collection,
        format: 'extended-json',
        filter: {},
        projection: {},
        sort: {},
        batchSize: 1000,
      },
    })
  }
  const planImport = () => {
    onPlanOperation?.({
      title: `Import into ${collection}`,
      operationId: 'mongodb.collection.import',
      objectName: collection,
      parameters: {
        database,
        collection,
        format: 'json',
        mode: 'insertMany',
        validation: 'validate-before-write',
        mapping: {},
      },
    })
  }

  return (
    <>
      {activeAdminOperation ? (
        <MongoCollectionOperationDialog
          collection={collection}
          database={database}
          operation={activeAdminOperation}
          onCancel={() => setActiveAdminOperation(undefined)}
          onPlan={planCollectionManagement}
        />
      ) : null}
      <MongoContextStrip
        eyebrow="MongoDB collection"
        title={[database, collection].filter(Boolean).join(' / ') || 'Unknown collection'}
        detail="Operational metadata is loaded lazily and document samples are bounded."
        metrics={[
          { label: 'Documents', value: stringValue(statistics.count ?? statistics.objects ?? '') || 'Unknown' },
          { label: 'Storage', value: formatBytes(numericValue(statistics.storageSize ?? statistics.size)) },
          { label: 'Indexes', value: indexes.length },
          { label: 'Validator', value: validator && Object.keys(asRecord(validator)).length ? 'Configured' : 'None' },
          { label: 'Sampled documents', value: sampleDocuments.length },
        ]}
      />
      <MongoResourceSection
        eyebrow="Document sample"
        title="Documents"
        description="A bounded sample for confirming shape and field coverage."
        actions={(
          <>
            <button
              type="button"
              className="drawer-button"
              disabled={!collection || !onOpenToolView}
              onClick={() => onOpenToolView?.('insert-document', 'Add Document')}
            >
              <PlusIcon className="panel-inline-icon" />
              Add document
            </button>
            <button
              type="button"
              className="drawer-button"
              disabled={!onPlanOperation || !collection}
              title="Review export settings before writing files."
              onClick={planExport}
            >
              <DownloadIcon className="panel-inline-icon" />
              Review export
            </button>
            <button
              type="button"
              className="drawer-button"
              disabled={!onPlanOperation || !collection}
              title="Review import settings before changing data."
              onClick={planImport}
            >
              <PlusIcon className="panel-inline-icon" />
              Review import
            </button>
          </>
        )}
      >
        <ObjectViewTable
          columns={['Document', 'Fields', 'Top fields']}
          rows={sampleDocuments.map((document, index) => [
            stringValue(document._id ?? `Document ${index + 1}`),
            String(Object.keys(document).length),
            documentFieldSummary(document),
          ])}
          emptyText="No document sample metadata was returned for this collection."
        />
      </MongoResourceSection>
      <MongoResourceSection
        eyebrow="Index inventory"
        title="Indexes"
        description={`${indexes.length} index${indexes.length === 1 ? '' : 'es'} returned`}
        actions={(
          <button
            type="button"
            className="drawer-button"
            disabled={!collection || !onOpenToolView}
            onClick={() => onOpenToolView?.('create-index', 'Create Index')}
          >
            <PlusIcon className="panel-inline-icon" />
            New index
          </button>
        )}
      >
        <ObjectViewTable
          columns={['Index', 'Key pattern', 'Options']}
          rows={indexes.map((index) => [
            stringValue(index.name),
            indexKeyPatternText(index.key),
            indexOptionsSummary(index, ['name', 'key']),
          ])}
          emptyText="No index metadata was returned for this collection."
        />
      </MongoResourceSection>
      <MongoResourceSection
        eyebrow="Data quality"
        title="Validation"
        description={validator && Object.keys(asRecord(validator)).length
          ? 'A collection validator is configured.'
          : 'This collection does not currently report a validator.'}
      >
        <div className="mongo-validation-summary">
          <span>Validator status</span>
          <strong>{validator && Object.keys(asRecord(validator)).length ? 'Configured' : 'Not configured'}</strong>
        </div>
      </MongoResourceSection>
      <MongoGuardedSection
        title="Collection administration"
        description="These operations require a guarded review before execution."
      >
        {mongoCollectionAdminActions.map((action) => {
          const Icon = action.icon
          const isDrop = action.id === 'drop-collection'
          return (
            <button
              type="button"
              className={`drawer-button ${isDrop ? 'drawer-button--danger' : ''}`}
              disabled={!onPlanOperation || !collection}
              key={action.id}
              title={action.description}
              onClick={() => {
                setManagementError('')
                setActiveAdminOperation(action.id)
              }}
            >
              <Icon className="panel-inline-icon" />
              {action.label}
            </button>
          )
        })}
        {managementError ? <p className="object-view-status is-error">{managementError}</p> : null}
      </MongoGuardedSection>
    </>
  )
}

function useResettableState<T>(resetValue: T) {
  const [state, setState] = useState(() => ({
    resetValue,
    value: resetValue,
  }))
  const value = Object.is(state.resetValue, resetValue) ? state.value : resetValue
  const setValue = (nextValue: T) => setState({ resetValue, value: nextValue })
  return [value, setValue] as const
}
