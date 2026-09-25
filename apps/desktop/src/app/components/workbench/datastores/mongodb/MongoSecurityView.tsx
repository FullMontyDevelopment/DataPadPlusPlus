import { useState } from 'react'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { PlusIcon, RenameIcon, TrashIcon } from '../../icons'
import { PurposeEmptyState } from '../../ObjectViewPrimitives'
import {
  asMongoRecord,
  mongoRecordArray,
  mongoString,
  type JsonRecord,
} from './MongoOperationalView.helpers'
import { MongoContextStrip, MongoResourceSection } from './MongoOperationalViewPrimitives'
import { MongoPrincipalEditor, type MongoPrincipalPlanner } from './MongoPrincipalEditor'

export function MongoSecurityView({
  kind,
  descriptor,
  payload,
  onPlanOperation,
}: {
  kind: string
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onPlanOperation?: MongoPrincipalPlanner
}) {
  if (kind === 'permissions') {
    return <MongoPermissionsView descriptor={descriptor} payload={payload} />
  }

  return (
    <MongoPrincipalManagementView
      descriptor={descriptor}
      isRoleView={kind === 'roles' || kind === 'role'}
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
  descriptor, isRoleView, payload, onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  isRoleView: boolean
  payload: JsonRecord
  onPlanOperation?: MongoPrincipalPlanner
}) {
  const database = mongoString(payload.database)
  const records = mongoRecordArray(isRoleView ? payload.roles : payload.users)
  const [editor, setEditor] = useState<{ principal?: JsonRecord; key: number }>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const noun = isRoleView ? 'role' : 'user'
  const blocked = !onPlanOperation || !database || Boolean(payload.warning) || pending
  const review: MongoPrincipalPlanner = async request => {
    if (blocked) return
    setPending(true)
    setError('')
    try { await onPlanOperation?.(request) } catch {
      setError('The operation could not be completed. Review the application error and refresh before retrying.')
    } finally { setPending(false) }
  }

  return <div className="object-view-section">
    <MongoContextStrip eyebrow={isRoleView ? 'Database roles' : 'Database users'} title={database || 'MongoDB'}
      detail={`${records.length} ${noun}${records.length === 1 ? '' : 's'} returned`}
      metrics={[{ label: isRoleView ? 'Roles' : 'Users', value: records.length }]} />
    <MongoResourceSection eyebrow="Security inventory" title={isRoleView ? 'Role inventory' : 'User inventory'}
      description="Native MongoDB administration. Changes require server privileges and confirmation; built-in roles are read-only. Atlas security is managed through its control plane."
      actions={<button type="button" className="drawer-button" disabled={blocked} onClick={() => setEditor(current => ({ key: (current?.key ?? 0) + 1 }))}>
        <PlusIcon className="panel-inline-icon" />New {noun}
      </button>}>
      {editor && onPlanOperation ? <MongoPrincipalEditor key={editor.key} database={database} isRole={isRoleView}
        principal={editor.principal} onReview={review} onCancel={() => setEditor(undefined)} /> : null}
      {error ? <p role="alert" className="object-view-status is-error">{error}</p> : null}
      {records.length ? <div className="object-view-table-wrap"><table className="object-view-table">
        <thead><tr>{[isRoleView ? 'Role' : 'User', 'Database', isRoleView ? 'Inherited roles' : 'Roles', isRoleView ? 'Privileges' : 'Details', 'Actions']
          .map(column => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{records.map(record => {
          const name = mongoString(record[isRoleView ? 'role' : 'user'] ?? record.name)
          const owner = mongoString(record.db) || database
          const builtin = record.isBuiltin === true
          const disabled = blocked || builtin || !name
          const reason = builtin ? 'Built-in MongoDB roles are read-only.' : undefined
          return <tr key={`${owner}:${name}`}>
            <td>{name}{builtin ? ' (built-in)' : ''}</td><td>{owner}</td>
            <td>{securityReferencesText(record.roles)}</td>
            <td>{isRoleView ? privilegesText(record.privileges) : userDetailsText(record)}</td>
            <td><div className="object-view-button-row">
              <button type="button" className="object-view-icon-action" aria-label={`Edit ${noun} ${name}`}
                disabled={disabled} title={reason ?? `Edit ${noun}`}
                onClick={() => setEditor(current => ({ principal: record, key: (current?.key ?? 0) + 1 }))}>
                <RenameIcon className="toolbar-icon" />
              </button>
              <button type="button" className="object-view-icon-action is-danger" aria-label={`Drop ${noun} ${name}`}
                disabled={disabled} title={reason ?? `Review ${noun} removal`}
                onClick={() => void review({ title: `Drop ${noun} ${name}`, operationId: `mongodb.${noun}.drop`,
                  objectName: name, parameters: { database: owner, name } })}>
                <TrashIcon className="toolbar-icon" />
              </button>
            </div></td>
          </tr>
        })}</tbody>
      </table></div> : <PurposeEmptyState descriptor={descriptor} />}
    </MongoResourceSection>
  </div>
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
