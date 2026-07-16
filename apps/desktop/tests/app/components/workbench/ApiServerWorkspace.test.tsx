import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { ApiServerWorkspace } from '../../../../src/app/components/workbench/ApiServerWorkspace'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'

const usersResource = {
  id: 'api-resource:table:users',
  kind: 'table' as const,
  label: 'users',
  nodeId: 'users',
  path: ['public', 'Tables', 'users'],
  scope: 'table:public.users',
  endpointSlug: 'users',
  enabled: true,
}

const usersByEmailEndpoint = {
  id: 'custom-users-by-email',
  label: 'Users by email',
  description: 'Find users by email.',
  endpointSlug: 'users-by-email',
  enabled: true,
  method: 'GET' as const,
  sourceLibraryNodeId: 'library-query-users-by-email',
  sourceName: 'Users query',
  queryText: 'select * from users where email = {{api.email}}',
  language: 'sql' as const,
  queryViewMode: 'raw' as const,
  rowLimit: 100,
  parameters: [
    {
      name: 'email',
      type: 'string' as const,
      required: true,
      serialization: 'auto' as const,
    },
  ],
}

const usersByEmailSource = {
  id: 'library-query-users-by-email',
  name: 'Users by email',
  summary: 'Find users by email.',
  connectionId: 'conn-analytics',
  environmentId: 'env-dev',
  language: 'sql' as const,
  queryViewMode: 'raw' as const,
  queryText: 'select * from users where email = {{api.email}}',
}

function renderApiServerWorkspace(
  overrides: Partial<ComponentProps<typeof ApiServerWorkspace>> = {},
) {
  const snapshot = createSeedSnapshot()
  const preferences = {
    ...snapshot.preferences,
    datastoreApiServer: {
      enabled: true,
      host: '127.0.0.1' as const,
      port: 17640,
      autoStart: false,
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      activeServerId: 'api-server-default',
      servers: [
        {
          id: 'api-server-default',
          name: 'Local API Server',
          host: '127.0.0.1' as const,
          port: 17640,
          autoStart: false,
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
          protocol: 'rest' as const,
          basePath: '',
          resources: [usersResource],
          customEndpoints: [],
        },
      ],
    },
  }
  const props: ComponentProps<typeof ApiServerWorkspace> = {
    connections: snapshot.connections,
    environments: snapshot.environments,
    preferences,
    onOpenExperimentalSettings: vi.fn(),
    onGetStatus: vi.fn().mockResolvedValue({
      enabled: true,
      running: false,
      host: '127.0.0.1',
      port: 17640,
      baseUrl: 'http://127.0.0.1:17640',
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      serverId: 'api-server-default',
      name: 'Local API Server',
      protocol: 'rest',
      basePath: '',
      resources: [usersResource],
      customEndpoints: [],
      activeServerId: 'api-server-default',
      message: 'API server is stopped.',
      warnings: [],
      servers: [
        {
          id: 'api-server-default',
          name: 'Local API Server',
          running: false,
          host: '127.0.0.1',
          port: 17640,
          baseUrl: 'http://127.0.0.1:17640',
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
          protocol: 'rest',
          basePath: '',
          resources: [usersResource],
          customEndpoints: [],
          message: 'API server is stopped.',
          warnings: [],
        },
      ],
    }),
    onGetMetrics: vi.fn().mockResolvedValue({
      running: true,
      generatedAt: '2026-06-14T00:00:00.000Z',
      startedAt: '2026-06-14T00:00:00.000Z',
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      totalRequests: 2,
      totalErrors: 1,
      requestBytes: 120,
      responseBytes: 640,
      routes: [
        {
          routeId: 'GET /v1/tables/users',
          method: 'GET',
          route: '/users',
          requests: 2,
          successes: 1,
          errors: 1,
          statusCounts: { '200': 1, '500': 1 },
          averageDurationMs: 4.2,
          p50DurationMs: 3.1,
          p95DurationMs: 5.3,
          lastDurationMs: 5.3,
          lastStatus: 500,
          lastSeenAt: '2026-06-14T00:00:00.000Z',
          requestBytes: 120,
          responseBytes: 640,
        },
      ],
      retention: { routeSamples: 256, logs: 500 },
    }),
    onGetLogs: vi.fn().mockResolvedValue({
      running: true,
      generatedAt: '2026-06-14T00:00:00.000Z',
      totalRetained: 1,
      entries: [
        {
          id: 1,
          timestamp: '2026-06-14T00:00:00.000Z',
          method: 'GET',
          path: '/v1/tables/users',
          route: '/users',
          status: 200,
          durationMs: 3.1,
          requestBytes: 60,
          responseBytes: 120,
        },
      ],
    }),
    onDeleteServer: vi.fn().mockResolvedValue(true),
    onUpdateServer: vi.fn().mockResolvedValue(true),
    onDiscoverResources: vi
      .fn()
      .mockResolvedValue({ resources: [usersResource], warnings: [] }),
    onAddResources: vi.fn().mockResolvedValue(true),
    onRemoveResource: vi.fn().mockResolvedValue(true),
    onDiscoverQuerySources: vi
      .fn()
      .mockResolvedValue({ serverId: 'api-server-default', sources: [] }),
    onAddCustomEndpoint: vi.fn().mockResolvedValue(true),
    onUpdateCustomEndpoint: vi.fn().mockResolvedValue(true),
    onRemoveCustomEndpoint: vi.fn().mockResolvedValue(true),
    onExportProject: vi.fn().mockResolvedValue({
      saved: true,
      path: 'C:\\Exports\\LocalAPIServer-rust.zip',
      framework: 'rust',
      projectName: 'LocalAPIServer',
      warnings: [],
    }),
    onUpdateSettings: vi.fn().mockResolvedValue(true),
    onStart: vi.fn().mockResolvedValue({
      enabled: true,
      running: true,
      host: '127.0.0.1',
      port: 17640,
      baseUrl: 'http://127.0.0.1:17640',
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      serverId: 'api-server-default',
      name: 'Local API Server',
      protocol: 'rest',
      basePath: '',
      resources: [usersResource],
      customEndpoints: [],
      activeServerId: 'api-server-default',
      startedAt: '2026-06-14T00:00:00.000Z',
      message: 'API server is running.',
      warnings: [],
      servers: [
        {
          id: 'api-server-default',
          name: 'Local API Server',
          running: true,
          host: '127.0.0.1',
          port: 17640,
          baseUrl: 'http://127.0.0.1:17640',
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
          protocol: 'rest',
          basePath: '',
          resources: [usersResource],
          customEndpoints: [],
          startedAt: '2026-06-14T00:00:00.000Z',
          message: 'API server is running.',
          warnings: [],
        },
      ],
    }),
    onStop: vi.fn().mockResolvedValue({
      enabled: true,
      running: false,
      host: '127.0.0.1',
      port: 17640,
      baseUrl: 'http://127.0.0.1:17640',
      serverId: 'api-server-default',
      name: 'Local API Server',
      activeServerId: 'api-server-default',
      message: 'API server is stopped.',
      warnings: [],
      servers: [
        {
          id: 'api-server-default',
          name: 'Local API Server',
          running: false,
          host: '127.0.0.1',
          port: 17640,
          baseUrl: 'http://127.0.0.1:17640',
          message: 'API server is stopped.',
          warnings: [],
        },
      ],
    }),
    ...overrides,
  }

  render(<ApiServerWorkspace {...props} />)
  return props
}

describe('ApiServerWorkspace', () => {
  it('shows the settings gate while disabled', () => {
    const props = renderApiServerWorkspace({
      preferences: {
        ...createSeedSnapshot().preferences,
        datastoreApiServer: {
          enabled: false,
          host: '127.0.0.1',
          port: 17640,
          autoStart: false,
          activeServerId: 'api-server-default',
          servers: [
            {
              id: 'api-server-default',
              name: 'Local API Server',
              host: '127.0.0.1',
              port: 17640,
              autoStart: false,
            },
          ],
        },
      },
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Open Plugins Settings' }),
    )

    expect(props.onOpenExperimentalSettings).toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'Start' }),
    ).not.toBeInTheDocument()
  })

  it('starts the selected datastore API server and lists generated endpoint routes', async () => {
    const props = renderApiServerWorkspace()

    expect(await screen.findByText('Resources')).toBeInTheDocument()
    expect(screen.getByText('/users')).toBeInTheDocument()
    expect(screen.queryByText('GET /health')).not.toBeInTheDocument()
    expect(screen.queryByText('GET /v1/meta')).not.toBeInTheDocument()
    expect(screen.queryByText('GET /v1/resources')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(props.onStart).toHaveBeenCalledWith({
        serverId: 'api-server-default',
      })
    })
    expect((await screen.findAllByText('Running')).length).toBeGreaterThan(0)
  })

  it('opens the resource picker before start is allowed', async () => {
    const snapshot = createSeedSnapshot()
    const emptyServerPreferences = {
      ...snapshot.preferences,
      datastoreApiServer: {
        enabled: true,
        host: '127.0.0.1' as const,
        port: 17640,
        autoStart: false,
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        activeServerId: 'api-server-default',
        servers: [
          {
            id: 'api-server-default',
            name: 'Local API Server',
            host: '127.0.0.1' as const,
            port: 17640,
            autoStart: false,
            connectionId: 'conn-analytics',
            environmentId: 'env-dev',
            protocol: 'rest' as const,
            basePath: '',
            resources: [],
          },
        ],
      },
    }
    const props = renderApiServerWorkspace({
      preferences: emptyServerPreferences,
      onGetStatus: vi.fn().mockResolvedValue({
        enabled: true,
        running: false,
        host: '127.0.0.1',
        port: 17640,
        baseUrl: 'http://127.0.0.1:17640',
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        serverId: 'api-server-default',
        name: 'Local API Server',
        protocol: 'rest',
        basePath: '',
        resources: [],
        activeServerId: 'api-server-default',
        message: 'API server is stopped.',
        warnings: [],
        servers: [
          {
            id: 'api-server-default',
            name: 'Local API Server',
            running: false,
            host: '127.0.0.1',
            port: 17640,
            baseUrl: 'http://127.0.0.1:17640',
            connectionId: 'conn-analytics',
            environmentId: 'env-dev',
            protocol: 'rest',
            basePath: '',
            resources: [],
            message: 'API server is stopped.',
            warnings: [],
          },
        ],
      }),
      onDiscoverResources: vi.fn().mockResolvedValue({
        resources: [
          usersResource,
          {
            ...usersResource,
            id: 'api-resource:table:orders',
            label: 'orders',
            nodeId: 'orders',
            path: ['public', 'orders'],
            endpointSlug: 'orders',
          },
        ],
        warnings: [],
      }),
    })

    expect(await screen.findByText('Resources')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(
      screen.getByText(
        'Choose tables, collections, databases, keys, items, or indexes from this datastore to generate endpoints.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Choose Resources' }))

    await waitFor(() => {
      expect(props.onDiscoverResources).toHaveBeenCalledWith({
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        limit: 500,
      })
    })
    expect(await screen.findByText('Select Resources')).toBeInTheDocument()
    const picker = screen.getByText('Select Resources').closest('section')
    if (!(picker instanceof HTMLElement)) {
      throw new Error('Expected resource picker section.')
    }
    const pickerControls = within(picker)
    const resourceCheckboxes = () => pickerControls.getAllByRole('checkbox')

    fireEvent.click(pickerControls.getByRole('button', { name: 'Deselect all' }))
    expect(resourceCheckboxes()).toHaveLength(2)
    expect(
      resourceCheckboxes().every((checkbox) => !(checkbox as HTMLInputElement).checked),
    ).toBe(true)

    fireEvent.click(pickerControls.getByRole('button', { name: 'Select all' }))
    expect(
      resourceCheckboxes().every((checkbox) => (checkbox as HTMLInputElement).checked),
    ).toBe(true)

    fireEvent.click(pickerControls.getByRole('button', { name: 'Add Selected' }))

    await waitFor(() => {
      expect(props.onAddResources).toHaveBeenCalledWith({
        serverId: 'api-server-default',
        resources: [
          usersResource,
          expect.objectContaining({
            id: 'api-resource:table:orders',
            label: 'orders',
          }),
        ],
      })
    })
    await waitFor(() => {
      expect(screen.queryByText('Select Resources')).not.toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete selected API server' }),
    )

    await waitFor(() => {
      expect(props.onDeleteServer).toHaveBeenCalledWith({
        serverId: 'api-server-default',
      })
    })
  })

  it('adds a custom query endpoint from a saved Library query', async () => {
    const props = renderApiServerWorkspace({
      onDiscoverQuerySources: vi.fn().mockResolvedValue({
        serverId: 'api-server-default',
        sources: [usersByEmailSource],
      }),
    })

    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Add Query Endpoint' }))[0],
    )

    await waitFor(() => {
      expect(props.onDiscoverQuerySources).toHaveBeenCalledWith({
        serverId: 'api-server-default',
      })
    })
    const dialog = await screen.findByRole('dialog', {
      name: 'Add Query Endpoint',
    })
    expect(within(dialog).getByText('email')).toBeInTheDocument()
    expect(
      within(dialog).getByText('select * from users where email = {{api.email}}'),
    ).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Method'), {
      target: { value: 'POST' },
    })
    fireEvent.change(within(dialog).getByLabelText('Max rows'), {
      target: { value: '25' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Endpoint' }))

    await waitFor(() => {
      expect(props.onAddCustomEndpoint).toHaveBeenCalledWith({
        serverId: 'api-server-default',
        endpoint: expect.objectContaining({
          label: 'Users by email',
          method: 'POST',
          sourceLibraryNodeId: 'library-query-users-by-email',
          queryText: 'select * from users where email = {{api.email}}',
          rowLimit: 25,
          parameters: [
            expect.objectContaining({
              name: 'email',
              type: 'string',
              required: true,
            }),
          ],
        }),
      })
    })
  })

  it('can start, edit, and remove a server with only a custom endpoint', async () => {
    const snapshot = createSeedSnapshot()
    const customOnlyPreferences = {
      ...snapshot.preferences,
      datastoreApiServer: {
        enabled: true,
        host: '127.0.0.1' as const,
        port: 17640,
        autoStart: false,
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        activeServerId: 'api-server-default',
        servers: [
          {
            id: 'api-server-default',
            name: 'Local API Server',
            host: '127.0.0.1' as const,
            port: 17640,
            autoStart: false,
            connectionId: 'conn-analytics',
            environmentId: 'env-dev',
            protocol: 'rest' as const,
            basePath: '',
            resources: [],
            customEndpoints: [usersByEmailEndpoint],
          },
        ],
      },
    }
    const status = {
      enabled: true,
      running: false,
      host: '127.0.0.1' as const,
      port: 17640,
      baseUrl: 'http://127.0.0.1:17640',
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      serverId: 'api-server-default',
      name: 'Local API Server',
      protocol: 'rest' as const,
      basePath: '',
      resources: [],
      customEndpoints: [usersByEmailEndpoint],
      activeServerId: 'api-server-default',
      message: 'API server is stopped.',
      warnings: [],
      servers: [
        {
          id: 'api-server-default',
          name: 'Local API Server',
          running: false,
          host: '127.0.0.1' as const,
          port: 17640,
          baseUrl: 'http://127.0.0.1:17640',
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
          protocol: 'rest' as const,
          basePath: '',
          resources: [],
          customEndpoints: [usersByEmailEndpoint],
          message: 'API server is stopped.',
          warnings: [],
        },
      ],
    }
    const runningStatus = {
      ...status,
      running: true,
      startedAt: '2026-06-14T00:00:00.000Z',
      message: 'API server is running.',
      servers: status.servers.map((server) => ({
        ...server,
        running: true,
        startedAt: '2026-06-14T00:00:00.000Z',
        message: 'API server is running.',
      })),
    }
    const props = renderApiServerWorkspace({
      preferences: customOnlyPreferences,
      onGetStatus: vi.fn().mockResolvedValue(status),
      onStart: vi.fn().mockResolvedValue(runningStatus),
      onDiscoverQuerySources: vi.fn().mockResolvedValue({
        serverId: 'api-server-default',
        sources: [usersByEmailSource],
      }),
    })

    expect(await screen.findByText('/users-by-email')).toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'Start' })
    expect(start).toBeEnabled()
    fireEvent.click(start)

    await waitFor(() => {
      expect(props.onStart).toHaveBeenCalledWith({
        serverId: 'api-server-default',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Edit Query Endpoint',
    })
    fireEvent.change(within(dialog).getByLabelText('Max rows'), {
      target: { value: '25' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Endpoint' }))

    await waitFor(() => {
      expect(props.onUpdateCustomEndpoint).toHaveBeenCalledWith({
        serverId: 'api-server-default',
        endpointId: 'custom-users-by-email',
        endpoint: expect.objectContaining({
          id: 'custom-users-by-email',
          rowLimit: 25,
        }),
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(props.onRemoveCustomEndpoint).toHaveBeenCalledWith({
        serverId: 'api-server-default',
        endpointId: 'custom-users-by-email',
      })
    })
  })

  it('exports the selected API server as a hostable project', async () => {
    const props = renderApiServerWorkspace({
      onExportProject: vi.fn().mockResolvedValue({
        saved: true,
        path: 'C:\\Exports\\AnalyticsApi-dotnet.zip',
        framework: 'dotnet',
        projectName: 'AnalyticsApi',
        warnings: ['Model `users` is inferred from sample metadata.'],
      }),
    })

    expect(await screen.findByText('Resources')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export Project' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Export API Server Project',
    })
    expect(within(dialog).getByText('Typed models required')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('/users')
    expect(dialog).toHaveTextContent('Schema: catalog columns')

    fireEvent.change(within(dialog).getByLabelText('Framework'), {
      target: { value: 'dotnet' },
    })
    fireEvent.change(within(dialog).getByLabelText('Project name'), {
      target: { value: 'AnalyticsApi' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export Zip' }))

    await waitFor(() => {
      expect(props.onExportProject).toHaveBeenCalledWith({
        serverId: 'api-server-default',
        framework: 'dotnet',
        projectName: 'AnalyticsApi',
        namespace: 'AnalyticsApi',
        packageName: undefined,
      })
    })
    expect(
      await within(dialog).findByText(/Saved dotnet project to/),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('Model `users` is inferred from sample metadata.'),
    ).toBeInTheDocument()
  })

  it('reenables resource discovery controls when discovery fails', async () => {
    const snapshot = createSeedSnapshot()
    let rejectDiscovery: (error: Error) => void = () => undefined
    const onDiscoverResources = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectDiscovery = reject
        }),
    )
    const emptyServerPreferences = {
      ...snapshot.preferences,
      datastoreApiServer: {
        enabled: true,
        host: '127.0.0.1' as const,
        port: 17640,
        autoStart: false,
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        activeServerId: 'api-server-default',
        servers: [
          {
            id: 'api-server-default',
            name: 'Local API Server',
            host: '127.0.0.1' as const,
            port: 17640,
            autoStart: false,
            connectionId: 'conn-analytics',
            environmentId: 'env-dev',
            protocol: 'rest' as const,
            basePath: '',
            resources: [],
          },
        ],
      },
    }
    renderApiServerWorkspace({
      preferences: emptyServerPreferences,
      onGetStatus: vi.fn().mockResolvedValue({
        enabled: true,
        running: false,
        host: '127.0.0.1',
        port: 17640,
        baseUrl: 'http://127.0.0.1:17640',
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        serverId: 'api-server-default',
        name: 'Local API Server',
        protocol: 'rest',
        basePath: '',
        resources: [],
        activeServerId: 'api-server-default',
        message: 'API server is stopped.',
        warnings: [],
        servers: [
          {
            id: 'api-server-default',
            name: 'Local API Server',
            running: false,
            host: '127.0.0.1',
            port: 17640,
            baseUrl: 'http://127.0.0.1:17640',
            connectionId: 'conn-analytics',
            environmentId: 'env-dev',
            protocol: 'rest',
            basePath: '',
            resources: [],
            message: 'API server is stopped.',
            warnings: [],
          },
        ],
      }),
      onDiscoverResources,
    })

    expect(await screen.findByText('Resources')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Choose Resources' }))

    expect(
      await screen.findByRole('button', { name: 'Discovering...' }),
    ).toBeDisabled()
    rejectDiscovery(new Error('Discovery failed'))

    expect(await screen.findByText('Select Resources')).toBeInTheDocument()
    expect(
      screen.getByText('No new CRUD-capable resources were discovered.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Choose Resources' }),
    ).toBeEnabled()
  })

  it('persists target changes without starting the listener', async () => {
    const props = renderApiServerWorkspace()

    fireEvent.change(screen.getByLabelText('Port'), {
      target: { value: '17641' },
    })

    await waitFor(() => {
      expect(props.onUpdateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'api-server-default',
          port: 17641,
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
        }),
      )
    })
    expect(props.onStart).not.toHaveBeenCalled()
  })

  it('keeps server name edits local until the field is committed', async () => {
    const props = renderApiServerWorkspace()
    const nameInput = await screen.findByLabelText('Name')

    fireEvent.change(nameInput, { target: { value: 'A' } })
    expect(nameInput).toHaveValue('A')
    expect(props.onUpdateServer).not.toHaveBeenCalled()

    fireEvent.change(nameInput, { target: { value: 'Analytics API' } })
    expect(nameInput).toHaveValue('Analytics API')
    expect(props.onUpdateServer).not.toHaveBeenCalled()

    fireEvent.blur(nameInput)

    await waitFor(() => {
      expect(props.onUpdateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'api-server-default',
          name: 'Analytics API',
        }),
      )
    })
  })

  it('shows OpenAPI and observability views for a running server', async () => {
    const props = renderApiServerWorkspace({
      onGetStatus: vi.fn().mockResolvedValue({
        enabled: true,
        running: true,
        host: '127.0.0.1',
        port: 17640,
        baseUrl: 'http://127.0.0.1:17640',
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        serverId: 'api-server-default',
        name: 'Local API Server',
        protocol: 'rest',
        basePath: '',
        resources: [usersResource],
        activeServerId: 'api-server-default',
        startedAt: '2026-06-14T00:00:00.000Z',
        message: 'API server is running.',
        warnings: [],
        servers: [
          {
            id: 'api-server-default',
            name: 'Local API Server',
            running: true,
            host: '127.0.0.1',
            port: 17640,
            baseUrl: 'http://127.0.0.1:17640',
            connectionId: 'conn-analytics',
            environmentId: 'env-dev',
            protocol: 'rest',
            basePath: '',
            resources: [usersResource],
            startedAt: '2026-06-14T00:00:00.000Z',
            message: 'API server is running.',
            warnings: [],
          },
        ],
      }),
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Docs' }))
    expect(
      await screen.findByTitle('API Server documentation'),
    ).toHaveAttribute('src', 'http://127.0.0.1:17640/docs')

    fireEvent.click(screen.getByRole('button', { name: 'Metrics' }))
    expect(await screen.findByText('/users')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(await screen.findByText('GET')).toBeInTheDocument()
    expect(props.onGetLogs).toHaveBeenCalledWith({
      serverId: 'api-server-default',
      limit: 80,
    })
  })
})
