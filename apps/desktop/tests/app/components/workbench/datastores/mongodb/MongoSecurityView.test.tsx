import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MongoSecurityView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoSecurityView'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'

describe('MongoSecurityView', () => {
  it('edits the selected user in its owning database and preserves all roles without resetting the password', async () => {
    const onPlanOperation = vi.fn()
    render(<MongoSecurityView kind="user" descriptor={getMongoObjectViewDescriptor('user')}
      payload={{ database: 'catalog', users: [{ user: 'alice', db: 'admin',
        roles: [{ role: 'read', db: 'catalog' }, { role: 'readWrite', db: 'audit' }] }] }}
      onPlanOperation={onPlanOperation} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit user alice' }))
    expect(screen.getByLabelText('Username')).toBeDisabled()
    expect(screen.getAllByLabelText('Assigned role')).toHaveLength(2)
    fireEvent.change(screen.getAllByLabelText('Assigned role')[0], { target: { value: 'readWrite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review user changes' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.user.update', objectName: 'alice',
      parameters: { database: 'admin', name: 'alice', roles: [{ role: 'readWrite', db: 'catalog' }, { role: 'readWrite', db: 'audit' }] },
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review user changes' })).toBeEnabled())
    expect(screen.getAllByLabelText('Assigned role')[0]).toHaveValue('readWrite')
  })

  it('edits custom-role privileges, accepts no inherited roles and blocks malformed JSON', async () => {
    const onPlanOperation = vi.fn()
    render(<MongoSecurityView kind="role" descriptor={getMongoObjectViewDescriptor('role')}
      payload={{ database: 'catalog', roles: [{ role: 'analyst', roles: [], privileges: [
        { resource: { db: 'catalog', collection: '' }, actions: ['find'] },
      ] }] }} onPlanOperation={onPlanOperation} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit role analyst' }))
    expect((screen.getByLabelText('Privileges (JSON)') as HTMLTextAreaElement).value).toContain('"find"')
    fireEvent.change(screen.getByLabelText('Privileges (JSON)'), { target: { value: '[invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review role changes' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Privileges must be valid JSON.')
    expect(onPlanOperation).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Privileges (JSON)'), { target: { value: '[]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review role changes' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.role.update', parameters: { database: 'catalog', name: 'analyst', roles: [], privileges: [] },
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review role changes' })).toBeEnabled())
  })

  it('keeps built-in roles visible but disables edit and removal', () => {
    render(<MongoSecurityView kind="roles" descriptor={getMongoObjectViewDescriptor('roles')}
      payload={{ database: 'admin', roles: [{ role: 'root', db: 'admin', isBuiltin: true }] }} onPlanOperation={vi.fn()} />)
    expect(screen.getByText('root (built-in)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit role root' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Drop role root' })).toBeDisabled()
  })

  it('disables management while inventory loading failed instead of suggesting an empty editable list', () => {
    render(<MongoSecurityView kind="users" descriptor={getMongoObjectViewDescriptor('users')}
      payload={{ database: 'admin', warning: 'Permission denied', users: [] }} onPlanOperation={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'New user' })).toBeDisabled()
  })

  it('retains edit drafts after an operation fails and can cancel without another request', async () => {
    const onPlanOperation = vi.fn().mockRejectedValue(new Error('permission denied'))
    render(<MongoSecurityView kind="users" descriptor={getMongoObjectViewDescriptor('users')}
      payload={{ database: 'admin', users: [{ user: 'alice', roles: [] }] }} onPlanOperation={onPlanOperation} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit user alice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add role assignment' }))
    fireEvent.change(screen.getByLabelText('Assigned role'), { target: { value: 'read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review user changes' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Assigned role')).toHaveValue('read')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(onPlanOperation).toHaveBeenCalledTimes(1)
  })

  it('plans Mongo user create and drop operations without exposing raw role JSON', async () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoSecurityView
        kind="users"
        descriptor={getMongoObjectViewDescriptor('users')}
        payload={{
          database: 'catalog',
          users: [{ user: 'reporting', roles: [{ role: 'read', db: 'catalog' }] }],
          roles: [{ role: 'readWrite', privileges: [] }],
        }}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getByText('read on catalog')).toBeInTheDocument()
    expect(screen.queryByText('[{"role":"read","db":"catalog"}]')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'analytics' } })
    fireEvent.change(screen.getByPlaceholderText('{{MONGO_USER_PASSWORD}}'), {
      target: { value: '{{MONGO_USER_PASSWORD}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review user creation' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.user.create',
      objectName: 'analytics',
      parameters: expect.objectContaining({
        password: '{{MONGO_USER_PASSWORD}}',
      }),
    }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Drop user reporting' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Drop user reporting' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.user.drop',
      objectName: 'reporting',
    }))
  })

  it('requires secret variables instead of plaintext Mongo user passwords', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoSecurityView
        kind="users"
        descriptor={getMongoObjectViewDescriptor('users')}
        payload={{ database: 'catalog', users: [], roles: [] }}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'analytics' } })
    fireEvent.change(screen.getByPlaceholderText('{{MONGO_USER_PASSWORD}}'), {
      target: { value: 'plain-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review user creation' }))

    expect(screen.getByText('Use an environment secret variable such as {{MONGO_USER_PASSWORD}}.')).toBeInTheDocument()
    expect(onPlanOperation).not.toHaveBeenCalled()
  })

  it('keeps role management in role mode even when user metadata is present', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoSecurityView
        kind="roles"
        descriptor={getMongoObjectViewDescriptor('roles')}
        payload={{
          database: 'catalog',
          users: [{ user: 'reporting', roles: [{ role: 'read', db: 'catalog' }] }],
          roles: [{
            role: 'analytics_reader',
            privileges: [{ resource: { db: 'catalog', collection: 'products' }, actions: ['find'] }],
          }],
        }}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getByText('find on catalog.products')).toBeInTheDocument()
    expect(screen.queryByText(/"actions":/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'inventory_reader' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review role creation' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.role.create',
      objectName: 'inventory_reader',
    }))
  })

  it('normalizes nested live permission payloads without exposing management actions', () => {
    render(
      <MongoSecurityView
        kind="permissions"
        descriptor={getMongoObjectViewDescriptor('permissions')}
        payload={{
          database: 'catalog',
          collection: 'products',
          result: {
            users: [{
              user: 'fixture_reader',
              inheritedPrivileges: [{
                resource: { db: 'catalog', collection: 'products' },
                actions: ['find', 'listIndexes'],
              }],
            }],
          },
        }}
      />,
    )

    expect(screen.getByText('fixture_reader')).toBeInTheDocument()
    expect(screen.getByText('catalog.products')).toBeInTheDocument()
    expect(screen.getByText('find, listIndexes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new user/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drop user/i })).not.toBeInTheDocument()
  })
})
