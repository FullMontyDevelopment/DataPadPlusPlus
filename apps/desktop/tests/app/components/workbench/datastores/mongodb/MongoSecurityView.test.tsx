import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MongoSecurityView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoSecurityView'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'

describe('MongoSecurityView', () => {
  it('plans Mongo user create and drop operations without exposing raw role JSON', () => {
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
