import { useCallback, useState } from 'react'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { CloseIcon, ObjectRoleIcon, PlusIcon, TrashIcon } from '../../icons'
import { PurposeEmptyState, SectionHeading } from '../../ObjectViewPrimitives'

type JsonRecord = Record<string, unknown>

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
  const users = arrayOfRecords(payload.users)
  const roles = arrayOfRecords(payload.roles)
  const database = stringValue(payload.database)
  const isRoleView = kind === 'roles'
  const roleReferenceCount = rowsForSecurityReferences(isRoleView ? roles : users, isRoleView)
  const privilegeCount = roles.reduce((count, role) => count + arrayOfRecords(role.privileges).length, 0)
  const [principalName, setPrincipalName] = useState('')
  const [passwordVariable, setPasswordVariable] = useState('')
  const [assignedRole, setAssignedRole] = useState('readWrite')
  const [assignedRoleDatabase, setAssignedRoleDatabase] = useState(database || 'admin')
  const [privilegeDatabase, setPrivilegeDatabase] = useState(database || 'admin')
  const [privilegeCollection, setPrivilegeCollection] = useState('')
  const [privilegeActions, setPrivilegeActions] = useState('find, insert, update')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [validationError, setValidationError] = useState('')
  const rows = isRoleView
    ? roles.map((role) => [
        stringValue(role.role ?? role.name),
        securityReferencesText(role.roles ?? role.inheritedRoles),
        privilegesText(role.privileges),
      ])
    : users.map((user) => [
        stringValue(user.user ?? user.name),
        securityReferencesText(user.roles),
        userDetailsText(user),
      ])
  const previewCreate = useCallback(() => {
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
    const roles = [{ role, db: roleDb }]
    const privilegeActionList = privilegeActions
      .split(',')
      .map((action) => action.trim())
      .filter(Boolean)
    const privileges = isRoleView && privilegeActionList.length
      ? [{
          resource: {
            db: privilegeDatabase.trim() || database || '',
            collection: privilegeCollection.trim(),
          },
          actions: privilegeActionList,
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
        roles,
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
  const previewDrop = useCallback((name: string) => {
    onPlanOperation?.({
      title: `${isRoleView ? 'Drop role' : 'Drop user'} ${name}`,
      operationId: isRoleView ? 'mongodb.role.drop' : 'mongodb.user.drop',
      objectName: name,
      parameters: {
        database,
        name,
      },
    })
  }, [database, isRoleView, onPlanOperation])

  return (
    <div className="object-view-section">
      <div className="object-view-section-heading-row">
        <SectionHeading Icon={ObjectRoleIcon} title={descriptor.title} unit={`${rows.length} row(s)`} />
        <button
          type="button"
          className="drawer-button"
          disabled={!onPlanOperation}
          title={isRoleView ? 'Create a MongoDB role' : 'Create a MongoDB user'}
          onClick={() => {
            setValidationError('')
            setShowCreateForm((current) => !current)
          }}
        >
          {showCreateForm ? <CloseIcon className="panel-inline-icon" /> : <PlusIcon className="panel-inline-icon" />}
          {showCreateForm ? 'Close' : isRoleView ? 'Create Role' : 'Create User'}
        </button>
      </div>
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>{isRoleView ? 'Roles' : 'Users'}</span>
          <strong>{rows.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Role references</span>
          <strong>{roleReferenceCount}</strong>
        </div>
        {isRoleView ? (
          <div className="object-view-card">
            <span>Privileges</span>
            <strong>{privilegeCount}</strong>
          </div>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <PurposeEmptyState descriptor={descriptor} />
      ) : (
        <div className="object-view-table-wrap">
          <table className="object-view-table">
            <thead>
              <tr>
                {(isRoleView ? ['Role', 'Inherited roles', 'Privileges', 'Actions'] : ['User', 'Roles', 'Details', 'Actions']).map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = row[0] ?? ''
                return (
                  <tr key={row.join('|')}>
                    {row.map((cell, index) => (
                      <td key={`${name}:${index}`}>{cell}</td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="object-view-icon-action is-danger"
                        aria-label={isRoleView ? `Drop role ${name}` : `Drop user ${name}`}
                        disabled={!onPlanOperation || !name}
                        title={isRoleView ? 'Drop role' : 'Drop user'}
                        onClick={() => previewDrop(name)}
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
      )}
      {showCreateForm ? (
      <div className="object-view-management">
        <strong>{isRoleView ? 'Create Role' : 'Create User'}</strong>
        <div className="object-view-form-grid">
          <label className="object-view-field">
            <span>{isRoleView ? 'Role name' : 'Username'}</span>
            <input
              value={principalName}
              onChange={(event) => setPrincipalName(event.target.value)}
              placeholder={isRoleView ? 'analytics_reader' : 'reporting_user'}
            />
          </label>
          <label className="object-view-field">
            <span>{isRoleView ? 'Inherited role' : 'Assigned role'}</span>
            <input
              value={assignedRole}
              onChange={(event) => setAssignedRole(event.target.value)}
              placeholder="readWrite"
            />
          </label>
          <label className="object-view-field">
            <span>Role database</span>
            <input
              value={assignedRoleDatabase}
              onChange={(event) => setAssignedRoleDatabase(event.target.value)}
              placeholder={database || 'admin'}
            />
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
          ) : null}
          {isRoleView ? (
            <>
              <label className="object-view-field">
                <span>Privilege database</span>
                <input
                  value={privilegeDatabase}
                  onChange={(event) => setPrivilegeDatabase(event.target.value)}
                  placeholder={database || 'admin'}
                />
              </label>
              <label className="object-view-field">
                <span>Privilege collection</span>
                <input
                  value={privilegeCollection}
                  onChange={(event) => setPrivilegeCollection(event.target.value)}
                  placeholder="Leave empty for database scope"
                />
              </label>
              <label className="object-view-field">
                <span>Actions</span>
                <input
                  value={privilegeActions}
                  onChange={(event) => setPrivilegeActions(event.target.value)}
                  placeholder="find, insert, update"
                />
              </label>
            </>
          ) : null}
        </div>
        {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
        <div className="object-view-button-row">
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation}
            onClick={previewCreate}
          >
            Run
          </button>
        </div>
      </div>
      ) : null}
    </div>
  )
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

function stringValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function rowsForSecurityReferences(records: JsonRecord[], isRoleView: boolean) {
  return records.reduce((count, record) => {
    const roleRows = isRoleView
      ? arrayOfRecords(record.roles ?? record.inheritedRoles)
      : arrayOfRecords(record.roles)
    return count + roleRows.length
  }, 0)
}

function isVariableToken(value: string) {
  return /^\{\{[A-Z][A-Z0-9_]*\}\}$/.test(value)
}

function securityReferencesText(value: unknown) {
  const references = Array.isArray(value) ? value : []
  if (references.length === 0) {
    return 'None'
  }

  return references.map((reference) => {
    if (typeof reference === 'string') {
      return reference
    }

    const record = asRecord(reference)
    const role = stringValue(record.role ?? record.name)
    const database = stringValue(record.db ?? record.database)
    return database ? `${role} on ${database}` : role
  }).filter(Boolean).join(', ')
}

function privilegesText(value: unknown) {
  const privileges = arrayOfRecords(value)
  if (privileges.length === 0) {
    return 'None'
  }

  return privileges.map((privilege) => {
    const actions = Array.isArray(privilege.actions)
      ? privilege.actions.map(String).join(', ')
      : stringValue(privilege.action ?? privilege.privilege)
    const resource = asRecord(privilege.resource)
    const database = stringValue(resource.db ?? resource.database)
    const collection = stringValue(resource.collection)
    const scope = [database, collection].filter(Boolean).join('.') || 'cluster'
    return actions ? `${actions} on ${scope}` : scope
  }).join(', ')
}

function userDetailsText(user: JsonRecord) {
  const mechanisms = Array.isArray(user.mechanisms)
    ? user.mechanisms.map(String).filter(Boolean)
    : []
  const privileges = privilegesText(user.privileges)

  if (mechanisms.length > 0 && privileges !== 'None') {
    return `${mechanisms.join(', ')}; ${privileges}`
  }

  if (mechanisms.length > 0) {
    return mechanisms.join(', ')
  }

  return privileges
}
