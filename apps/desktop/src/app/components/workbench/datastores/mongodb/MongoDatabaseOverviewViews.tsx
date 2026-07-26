import { useState } from 'react'
import { PlusIcon, TrashIcon } from '../../icons'
import { ObjectViewTable } from '../../ObjectViewPrimitives'
import { MongoCollectionCreatePanel } from './MongoCollectionCreatePanel'
import {
  arrayOfRecords,
  asRecord,
  metadataSummary,
  pipelineSummary,
  stringValue,
} from './MongoOverviewView.helpers'
import { MongoResourceSection } from './MongoOperationalViewPrimitives'
import type { MongoOperationPlanner, MongoOverviewPayload } from './MongoOverviewView.types'

export function MongoDatabasesOverview({
  payload,
  readOnly,
  onPlanOperation,
}: {
  payload: MongoOverviewPayload
  readOnly: boolean
  onPlanOperation?: MongoOperationPlanner
}) {
  const databases = arrayOfRecords(payload.databases)
  const [showCreateDatabase, setShowCreateDatabase] = useState(false)

  return (
    <MongoResourceSection
      eyebrow={readOnly ? 'System catalog' : 'Database inventory'}
      title={readOnly ? 'System database inventory' : 'User databases'}
      description={`${databases.length} database${databases.length === 1 ? '' : 's'} returned`}
      actions={!readOnly ? (
        <button
          type="button"
          className="drawer-button"
          disabled={!onPlanOperation}
          aria-expanded={showCreateDatabase}
          onClick={() => setShowCreateDatabase((current) => !current)}
        >
          <PlusIcon className="panel-inline-icon" />
          {showCreateDatabase ? 'Close' : 'New database'}
        </button>
      ) : null}
    >
      {showCreateDatabase ? (
        <MongoCollectionCreatePanel
          database=""
          mode="database"
          onCancel={() => setShowCreateDatabase(false)}
          onPlanOperation={onPlanOperation}
        />
      ) : null}
      <ObjectViewTable
        columns={['Database', 'Type', 'Details']}
        rows={databases.map((database) => [
          stringValue(database.name ?? database.database),
          stringValue(database.type) || (database.system ? 'System' : 'User'),
          metadataSummary(database, ['name', 'database', 'type', 'system']),
        ])}
        emptyText={readOnly
          ? 'No system database metadata was returned.'
          : 'No user database metadata was returned.'}
      />
    </MongoResourceSection>
  )
}

export function MongoDatabaseOverview({
  payload,
  onPlanOperation,
}: {
  payload: MongoOverviewPayload
  onPlanOperation?: MongoOperationPlanner
}) {
  const collections = arrayOfRecords(payload.collections)
  const views = arrayOfRecords(payload.views)
  const timeSeriesCollections = arrayOfRecords(payload.timeSeriesCollections)
  const cappedCollections = arrayOfRecords(payload.cappedCollections)
  const gridfsBuckets = arrayOfRecords(payload.gridfsBuckets)
  const users = arrayOfRecords(payload.users)
  const roles = arrayOfRecords(payload.roles)
  const stats = asRecord(payload.statistics ?? payload.stats)
  const database = stringValue(payload.database)
  const [isCreateCollectionOpen, setIsCreateCollectionOpen] = useState(false)
  const isSystemDatabase = isMongoSystemDatabase(database)
  const collectionRows = [
    ...collections.map((collection) => [
      stringValue(collection.name ?? collection.collection),
      'Collection',
      metadataSummary(collection, ['name', 'collection', 'type']),
    ]),
    ...timeSeriesCollections.map((collection) => [
      stringValue(collection.name ?? collection.collection),
      'Time series',
      metadataSummary(collection, ['name', 'collection', 'type']),
    ]),
    ...cappedCollections.map((collection) => [
      stringValue(collection.name ?? collection.collection),
      'Capped',
      metadataSummary(collection, ['name', 'collection', 'type']),
    ]),
    ...views.map((view) => [
      stringValue(view.name ?? view.view),
      'View',
      pipelineSummary(view.pipeline),
    ]),
  ]
  const planDropDatabase = () => {
    if (!database || isSystemDatabase) {
      return
    }

    onPlanOperation?.({
      title: `Drop database ${database}`,
      operationId: 'mongodb.database.drop',
      objectName: database,
      parameters: { database },
    })
  }

  return (
    <>
      <div className="mongo-database-summary">
        <div className="mongo-database-summary-heading">
          <div>
            <span>MongoDB database</span>
            <strong>{database || 'Unknown database'}</strong>
          </div>
          <span>Operational overview</span>
        </div>
        <dl className="mongo-database-metrics">
          <div>
            <dt>Collections</dt>
            <dd>{collections.length + timeSeriesCollections.length + cappedCollections.length}</dd>
          </div>
          <div>
            <dt>Views</dt>
            <dd>{views.length}</dd>
          </div>
          <div>
            <dt>GridFS buckets</dt>
            <dd>{gridfsBuckets.length}</dd>
          </div>
          <div>
            <dt>Users / roles</dt>
            <dd>{users.length} / {roles.length}</dd>
          </div>
          <div>
            <dt>Objects</dt>
            <dd>{stringValue(stats.objects ?? stats.collections ?? '') || 'Unknown'}</dd>
          </div>
        </dl>
      </div>

      <section className="mongo-database-collections" aria-labelledby="mongo-collection-inventory-title">
        <header className="mongo-database-section-header">
          <div>
            <span>Collection inventory</span>
            <h2 id="mongo-collection-inventory-title">Collections</h2>
            <p>
              {collectionRows.length
                ? `${collectionRows.length} database object${collectionRows.length === 1 ? '' : 's'} available`
                : 'No collections or views have been returned for this database.'}
            </p>
          </div>
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation || !database}
            aria-controls="mongo-create-collection-panel"
            aria-expanded={isCreateCollectionOpen}
            onClick={() => setIsCreateCollectionOpen((open) => !open)}
          >
            <PlusIcon className="panel-inline-icon" />
            New collection
          </button>
        </header>

        {isCreateCollectionOpen ? (
          <MongoCollectionCreatePanel
            database={database}
            onCancel={() => setIsCreateCollectionOpen(false)}
            onPlanOperation={onPlanOperation}
          />
        ) : null}

        <ObjectViewTable
          columns={['Name', 'Type', 'Details']}
          rows={collectionRows}
          emptyText="No collections or views were returned for this database."
        />
      </section>

      <section className="mongo-database-administration" aria-labelledby="mongo-database-administration-title">
        <div className="mongo-database-administration-copy">
          <span>Guarded operation</span>
          <h2 id="mongo-database-administration-title">Database administration</h2>
          <p>Dropping this database removes every collection and document it contains.</p>
        </div>
        <button
          type="button"
          className="drawer-button drawer-button--danger"
          disabled={!onPlanOperation || !database || isSystemDatabase}
          title={isSystemDatabase ? 'System databases cannot be dropped from DataPad++.' : undefined}
          onClick={planDropDatabase}
        >
          <TrashIcon className="panel-inline-icon" />
          Review drop database
        </button>
      </section>
    </>
  )
}

function isMongoSystemDatabase(database: string) {
  return database === 'admin' || database === 'config' || database === 'local'
}
