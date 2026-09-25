import { useState } from 'react'
import { PlusIcon, TrashIcon } from '../../icons'
import { asMongoRecord, mongoString, type JsonRecord } from './MongoOperationalView.helpers'

export type MongoPrincipalOperation = {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}
export type MongoPrincipalPlanner = (request: MongoPrincipalOperation) => void | Promise<void>

export function MongoPrincipalEditor({
  database, isRole, principal, onReview, onCancel,
}: {
  database: string
  isRole: boolean
  principal?: JsonRecord
  onReview: MongoPrincipalPlanner
  onCancel(): void
}) {
  const editing = Boolean(principal)
  const principalDatabase = mongoString(principal?.db) || database
  const [name, setName] = useState(mongoString(principal?.[isRole ? 'role' : 'user']))
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState(() => principal
    ? (Array.isArray(principal.roles) ? principal.roles : []).map(value => {
        const role = asMongoRecord(value)
        return { role: typeof value === 'string' ? value : mongoString(role.role), db: mongoString(role.db) || principalDatabase }
      })
    : [{ role: isRole ? '' : 'readWrite', db: principalDatabase }])
  const [privileges, setPrivileges] = useState(JSON.stringify(principal?.privileges ?? [], null, 2))
  // Blank advanced fields are deliberately omitted, not replaced with defaults.
  const [customData, setCustomData] = useState('')
  const [restrictions, setRestrictions] = useState('')
  const [mechanisms, setMechanisms] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const review = async () => {
    try {
      if (!name.trim()) throw new Error(isRole ? 'Role name is required.' : 'Username is required.')
      const assignments = roles.filter(role => role.role.trim() || !isRole)
      if (assignments.some(role => !role.role.trim() || !role.db.trim())) throw new Error('Every assigned role needs a name and database.')
      if (!isRole && password && !/^\{\{[A-Za-z_][A-Za-z0-9_]*\}\}$/.test(password.trim())) {
        throw new Error('Use an environment secret variable such as {{MONGO_USER_PASSWORD}}.')
      }
      if (!isRole && !editing && principalDatabase !== '$external' && !password.trim()) {
        throw new Error('Choose an environment secret variable for the new user’s password.')
      }
      if (!isRole && principalDatabase === '$external' && password) throw new Error('$external users do not use a database password.')
      const parameters: Record<string, unknown> = {
        database: principalDatabase, name: editing ? name : name.trim(),
        roles: assignments.map(role => ({ role: role.role.trim(), db: role.db.trim() })),
      }
      if (!isRole && password.trim()) parameters.password = password.trim()
      const parse = (text: string, label: string, array: boolean) => {
        let value: unknown
        try { value = JSON.parse(text) } catch { throw new Error(`${label} must be valid JSON.`) }
        if (array ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`${label} must be a JSON ${array ? 'array' : 'object'}.`)
        }
        return value
      }
      if (isRole) parameters.privileges = parse(privileges, 'Privileges', true)
      if (customData.trim()) parameters.customData = parse(customData, 'Custom data', false)
      if (restrictions.trim()) parameters.authenticationRestrictions = parse(restrictions, 'Authentication restrictions', true)
      if (mechanisms.trim()) parameters.mechanisms = parse(mechanisms, 'Authentication mechanisms', true)
      setError('')
      setBusy(true)
      await onReview({
        title: `${editing ? 'Edit' : 'Create'} ${isRole ? 'role' : 'user'} ${name}`,
        operationId: `mongodb.${isRole ? 'role' : 'user'}.${editing ? 'update' : 'create'}`,
        objectName: parameters.name as string, parameters,
      })
      // Keep drafts after canceled confirmation, permission failures, or refresh.
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to review these changes.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="mongo-inline-editor" aria-label={editing ? 'Edit principal' : 'Create principal'}>
    <p>{editing ? 'Update' : 'Create'} {isRole ? 'role' : 'user'} in <strong>{principalDatabase}</strong>.
      {editing ? ' The complete role list is replaced when you confirm. Other properties stay unchanged unless supplied.' : ''}</p>
    <fieldset disabled={busy} className="mongo-principal-fields">
      <div className="object-view-form-grid">
        <label className="object-view-field"><span>{isRole ? 'Role name' : 'Username'}</span>
          <input value={name} disabled={editing} onChange={event => setName(event.target.value)} />
        </label>
        {!isRole && principalDatabase !== '$external' ? <label className="object-view-field">
          <span>Password variable</span>
          <input value={password} placeholder="{{MONGO_USER_PASSWORD}}" onChange={event => setPassword(event.target.value)} />
          <small>{editing ? 'Leave blank to keep the current password. ' : ''}Use a secret variable from this tab’s environment.</small>
        </label> : null}
      </div>
      <h4>{isRole ? 'Inherited roles' : 'Assigned roles'}</h4>
      {roles.map((role, index) => <div className="mongo-principal-role-row" key={index}>
        <label className="object-view-field"><span>{isRole ? 'Inherited role' : 'Assigned role'}</span>
          <input value={role.role} onChange={event => setRoles(current => current.map((item, i) => i === index ? { ...item, role: event.target.value } : item))} />
        </label>
        <label className="object-view-field"><span>Role database</span>
          <input value={role.db} onChange={event => setRoles(current => current.map((item, i) => i === index ? { ...item, db: event.target.value } : item))} />
        </label>
        <button type="button" className="object-view-icon-action" aria-label={`Remove role assignment ${index + 1}`} onClick={() => setRoles(current => current.filter((_, i) => i !== index))}>
          <TrashIcon className="toolbar-icon" />
        </button>
      </div>)}
      <button type="button" className="drawer-button" onClick={() => setRoles(current => [...current, { role: '', db: principalDatabase }])}>
        <PlusIcon className="panel-inline-icon" />Add role assignment
      </button>
      {isRole ? <label className="object-view-field"><span>Privileges (JSON)</span>
        <textarea aria-label="Privileges (JSON)" rows={8} value={privileges} onChange={event => setPrivileges(event.target.value)} spellCheck={false} />
        <small>Native privilege objects: resource and actions. An empty array grants no direct privileges.</small>
      </label> : null}
      <details><summary>Advanced options</summary>
        <p>Leave blank to preserve existing values. Use an empty array or object only to explicitly clear a property.</p>
        <label className="object-view-field"><span>Authentication restrictions (JSON)</span>
          <textarea rows={3} value={restrictions} onChange={event => setRestrictions(event.target.value)} spellCheck={false} />
        </label>
        {!isRole ? <>
          <label className="object-view-field"><span>Custom data (JSON)</span><textarea rows={3} value={customData} onChange={event => setCustomData(event.target.value)} spellCheck={false} /></label>
          <label className="object-view-field"><span>Authentication mechanisms (JSON)</span><input value={mechanisms} onChange={event => setMechanisms(event.target.value)} placeholder='["SCRAM-SHA-256"]' /></label>
        </> : null}
      </details>
      {error ? <p role="alert" className="object-view-status is-error">{error}</p> : null}
      <div className="object-view-button-row">
        <button type="button" className="drawer-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="drawer-button drawer-button--primary" onClick={() => void review()}>
          {busy ? 'Reviewing…' : `Review ${isRole ? 'role' : 'user'} ${editing ? 'changes' : 'creation'}`}
        </button>
      </div>
    </fieldset>
  </div>
}
