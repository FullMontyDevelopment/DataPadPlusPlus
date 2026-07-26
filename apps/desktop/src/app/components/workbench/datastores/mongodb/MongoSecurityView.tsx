import { useCallback, useState } from 'react'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { CloseIcon, PlusIcon, TrashIcon } from '../../icons'
import { PurposeEmptyState } from '../../ObjectViewPrimitives'
import {
  asMongoRecord,
  mongoRecordArray,
  mongoString,
  type JsonRecord,
} from './MongoOperationalView.helpers'
import { MongoContextStrip, MongoResourceSection } from './MongoOperationalViewPrimitives'

type MongoOperationPlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

export function MongoSecurityView({
  kind,
  descriptor,
  payload,
  onPlanOperation,
}: {
  kind: string
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onPlanOperation?: MongoOperationPlanner
}) {
  if (kind === 'permissions') {
    return <MongoPermissionsView descriptor={descriptor} payload={payload} />
  }

  return (
    <MongoPrincipalManagementView
      descriptor={descriptor}
      isRoleView={kind === 'roles'}
      payload={payload}
      onPlanOperation={onPlanOperation}
    />
  )
}

function MongoPermissionsView({
  descriptor,
  payload,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
}) {
  const result = asMongoRecord(payload.result)
  const users = mongoRecordArray(payload.users).length
    ? mongoRecordArray(payload.users)
    : mongoRecordArray(result.users)
  const database = mongoString(payload.database)
  const collection = mongoString(payload.collection)
  const rows = users.flatMap((user) => permissionRows(user, database, collection))
  const principalCount = new Set(rows.map((row) => row[0])).size
  const actionCount = rows.reduce((count, row) =>
    count + (row[3] ?? '').split(',').map((action) => action.trim()).filter(Boolean).length, 0)

  return (
    <div className="object-view-section">
      <MongoContextStrip
        eyebrow="Effective permissions"
        title={[database, collection].filter(Boolean).join(' / ') || 'MongoDB'}
        detail="Read-only metadata returned for the connected identity."
        metrics={[
          { label: 'Principals', value: principalCount },
          { label: 'Permission rows', value: rows.length },
          { label: 'Actions', value: actionCount },
        ]}
      />
      <MongoResourceSection
        eyebrow="Authorization"
        title="Permissions"
        description="Database-wide privileges and privileges that apply to the selected collection."
      >
        {rows.length ? (
          <div className="object-view-table-wrap">
            <table className="object-view-table">
              <thead>
                <tr>
                  {['Principal', 'Role', 'Resource', 'Actions'].map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${row.join(':')}:${rowIndex}`}>
                    {row.map((cell, index) => <td key={`${rowIndex}:${index}`}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <PurposeEmptyState descriptor={descriptor} />
        )}
      </MongoResourceSection>
    </div>
  )
}

function MongoPrincipalManagementView({
  descriptor,
  isRoleView,
  payload,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  isRoleView: boolean
  payload: JsonRecord
  onPlanOperation?: MongoOperationPlanner
}) {
  const users = mongoRecordArray(payload.users)
  const roles = mongoRecordArray(payload.roles)
  const database = mongoString(payload.database)
  const records = isRoleView ? roles : users
  const rows = isRoleView
    ? roles.map((role) => [
        mongoString(role.role ?? role.name),
        securityReferencesText(role.roles ?? role.inheritedRoles),
        privilegesText(role.privileges),
      ])
    : users.map((user) => [
        mongoString(user.user ?? user.name),
        securityReferencesText(user.roles),
        userDetailsText(user),
      ])
  const roleReferenceCount = records.reduce((count, record) =>
    count + mongoRecordArray(isRoleView ? record.roles ?? record.inheritedRoles : record.roles).length, 0)
  const privilegeCount = records.reduce((count, record) =>
    count + mongoRecordArray(record.privileges ?? record.inheritedPrivileges).length, 0)
  const [principalName, setPrincipalName] = useState('')
  const [passwordVariable, setPasswordVariable] = useState('')
  const [assignedRole, setAssignedRole] = useState('readWrite')
  const [assignedRoleDatabase, setAssignedRoleDatabase] = useState(database || 'admin')
  const [privilegeDatabase, setPrivilegeDatabase] = useState(database || 'admin')
  const [privilegeCollection, setPrivilegeCollection] = useState('')
  const [privilegeActions, setPrivilegeActions] = useState('find, insert, update')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [validationError, setValidationError] = useState('')

  const reviewCreate = useCallback(() => {
    const name = principalName.trim()
    if (!name) {
      setValidationError(isRoleView ? 'Role name is required.' : 'Username is required.')
      return
    }
    const role = assignedRole.trim()
    const roleDb = assignedRoleDatabase.trim() || database || 'admin'
    if (!role) {
      setValidationError('Assigned role is required.')
      return
    }
    const passwordToken = passwordVariable.trim()
    if (!isRoleView && passwordToken && !isVariableToken(passwordToken)) {
      setValidationError('Use an environment secret variable such as {{MONGO_USER_PASSWORD}}.')
      return
    }
    const roleAssignments = [{ role, db: roleDb }]
    const actions = privilegeActions.split(',').map((action) => action.trim()).filter(Boolean)
    const privileges = isRoleView && actions.length
      ? [{
          resource: {
            db: privilegeDatabase.trim() || database || '',
            collection: privilegeCollection.trim(),
          },
          actions,
        }]
      : []
    setValidationError('')
    setShowCreateForm(false)
    onPlanOperation?.({
      title: `${isRoleView ? 'Create role' : 'Create user'} ${name}`,
      operationId: isRoleView ? 'mongodb.role.create' : 'mongodb.user.create',
      objectName: name,
      parameters: {
        database,
        name,
        ...(!isRoleView && passwordToken ? { password: passwordToken } : {}),
        roles: roleAssignments,
        privileges,
      },
    })
  }, [
    assignedRole,
    assignedRoleDatabase,
    database,
    isRoleView,
    onPlanOperation,
    passwordVariable,
    principalName,
    privilegeActions,
    privilegeCollection,
    privilegeDatabase,
  ])
  const reviewDrop = useCallback((name: string) => {
    onPlanOperation?.({
      title: `${isRoleView ? 'Drop role' : 'Drop user'} ${name}`,
      operationId: isRoleView ? 'mongodb.role.drop' : 'mongodb.user.drop',
      objectName: name,
      parameters: { database, name },
    })
  }, [database, isRoleView, onPlanOperation])

  return (
    <div className="object-view-section">
      <MongoContextStrip
        eyebrow={isRoleView ? 'Database roles' : 'Database users'}
        title={database || 'MongoDB'}
        detail={`${rows.length} ${isRoleView ? 'role' : 'user'}${rows.length === 1 ? '' : 's'} returned`}
        metrics={[
          { label: isRoleView ? 'Roles' : 'Users', value: rows.length },
          { label: 'Role references', value: roleReferenceCount },
          ...(isRoleView ? [{ label: 'Privileges', value: privilegeCount }] : []),
        ]}
      />
      <MongoResourceSection
        eyebrow="Security inventory"
        title={isRoleView ? 'Role inventory' : 'User inventory'}
        description={isRoleView
          ? 'Roles and their inherited access for this database.'
          : 'Users visible to the connected identity.'}
        actions={(
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation}
            aria-expanded={showCreateForm}
            onClick={() => {
              setValidationError('')
              setShowCreateForm((current) => !current)
            }}
          >
            {showCreateForm ? <CloseIcon className="panel-inline-icon" /> : <PlusIcon className="panel-inline-icon" />}
            {showCreateForm ? 'Close' : isRoleView ? 'New role' : 'New user'}
          </button>
        )}
      >
        {showCreateForm ? (
          <div className="mongo-inline-editor">
            <div className="object-view-form-grid">
              <label className="object-view-field">
                <span>{isRoleView ? 'Role name' : 'Username'}</span>
                <input value={principalName} onChange={(event) => setPrincipalName(event.target.value)} />
              </label>
              <label className="object-view-field">
                <span>{isRoleView ? 'Inherited role' : 'Assigned role'}</span>
                <input value={assignedRole} onChange={(event) => setAssignedRole(event.target.value)} />
              </label>
              <label className="object-view-field">
                <span>Role database</span>
                <input value={assignedRoleDatabase} onChange={(event) => setAssignedRoleDatabase(event.target.value)} />
              </label>
              {!isRoleView ? (
                <label className="object-view-field">
                  <span>Password variable</span>
                  <input
                    value={passwordVariable}
                    onChange={(event) => setPasswordVariable(event.target.value)}
                    placeholder="{{MONGO_USER_PASSWORD}}"
                  />
                </label>
              ) : (
                <>
                  <label className="object-view-field">
                    <span>Privilege database</span>
                    <input value={privilegeDatabase} onChange={(event) => setPrivilegeDatabase(event.target.value)} />
                  </label>
                  <label className="object-view-field">
                    <span>Privilege collection</span>
                    <input value={privilegeCollection} onChange={(event) => setPrivilegeCollection(event.target.value)} />
                  </label>
                  <label className="object-view-field">
                    <span>Actions</span>
                    <input value={privilegeActions} onChange={(event) => setPrivilegeActions(event.target.value)} />
                  </label>
                </>
              )}
            </div>
            {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
            <div className="object-view-button-row">
              <button type="button" className="drawer-button drawer-button--primary" onClick={reviewCreate}>
                Review {isRoleView ? 'role' : 'user'} creation
              </button>
            </div>
          </div>
        ) : null}
        {rows.length ? (
          <div className="object-view-table-wrap">
            <table className="object-view-table">
              <thead>
                <tr>
                  {(isRoleView
                    ? ['Role', 'Inherited roles', 'Privileges', 'Actions']
                    : ['User', 'Roles', 'Details', 'Actions'])
                    .map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = row[0] ?? ''
                  return (
                    <tr key={row.join('|')}>
                      {row.map((cell, index) => <td key={`${name}:${index}`}>{cell}</td>)}
                      <td>
                        <button
                          type="button"
                          className="object-view-icon-action is-danger"
                          aria-label={isRoleView ? `Drop role ${name}` : `Drop user ${name}`}
                          disabled={!onPlanOperation || !name}
                          title={isRoleView ? 'Review role removal' : 'Review user removal'}
                          onClick={() => reviewDrop(name)}
                        >
                          <TrashIcon className="toolbar-icon" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <PurposeEmptyState descriptor={descriptor} />}
      </MongoResourceSection>
    </div>
  )
}

function permissionRows(user: JsonRecord, database: string, collection: string): string[][] {
  const principal = mongoString(user.user ?? user.name) || 'Connected user'
  const privileges = mongoRecordArray(user.inheritedPrivileges ?? user.privileges)
  const rows = privileges.flatMap((privilege) => {
    const resource = asMongoRecord(privilege.resource)
    const resourceDatabase = mongoString(resource.db ?? resource.database)
    const resourceCollection = mongoString(resource.collection)
    if (
      (database && resourceDatabase && resourceDatabase !== database) ||
      (collection && resourceCollection && resourceCollection !== collection)
    ) {
      return []
    }
    const actions = Array.isArray(privilege.actions)
      ? privilege.actions.map(String).join(', ')
      : mongoString(privilege.action ?? privilege.privilege)
    return [[
      principal,
      '',
      [resourceDatabase || database, resourceCollection || '*'].filter(Boolean).join('.') || 'Cluster',
      actions || 'Unspecified',
    ]]
  })
  if (rows.length) {
    return rows
  }
  return securityReferences(user.roles).map((role) => [
    principal,
    role.label,
    role.database ? `${role.database}.*` : 'Cluster',
    'Inherited from role',
  ])
}

function securityReferences(value: unknown) {
  return (Array.isArray(value) ? value : []).map((reference) => {
    if (typeof reference === 'string') {
      return { label: reference, database: '' }
    }
    const record = asMongoRecord(reference)
    return {
      label: mongoString(record.role ?? record.name),
      database: mongoString(record.db ?? record.database),
    }
  }).filter((reference) => reference.label)
}

function securityReferencesText(value: unknown) {
  const references = securityReferences(value)
  return references.length
    ? references.map((reference) =>
        reference.database ? `${reference.label} on ${reference.database}` : reference.label).join(', ')
    : 'None'
}

function privilegesText(value: unknown) {
  const privileges = mongoRecordArray(value)
  return privileges.length
    ? privileges.map((privilege) => {
        const resource = asMongoRecord(privilege.resource)
        const scope = [
          mongoString(resource.db ?? resource.database),
          mongoString(resource.collection),
        ].filter(Boolean).join('.') || 'cluster'
        const actions = Array.isArray(privilege.actions)
          ? privilege.actions.map(String).join(', ')
          : mongoString(privilege.action ?? privilege.privilege)
        return actions ? `${actions} on ${scope}` : scope
      }).join(', ')
    : 'None'
}

function userDetailsText(user: JsonRecord) {
  const mechanisms = Array.isArray(user.mechanisms) ? user.mechanisms.map(String).filter(Boolean) : []
  const privileges = privilegesText(user.privileges ?? user.inheritedPrivileges)
  return [...mechanisms, ...(privileges === 'None' ? [] : [privileges])].join('; ') || 'No additional details'
}

function isVariableToken(value: string) {
  return /^\{\{[A-Z][A-Z0-9_]*\}\}$/.test(value)
}
