import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { ApiServerWorkspace } from '../../../../src/app/components/workbench/ApiServerWorkspace'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'

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
      servers: [{
        id: 'api-server-default',
        name: 'Local API Server',
        host: '127.0.0.1' as const,
        port: 17640,
        autoStart: false,
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
      }],
    },
  }
  const props: ComponentProps<typeof ApiServerWorkspace> = {
    activeConnection: snapshot.connections[0],
    activeEnvironment: snapshot.environments[0],
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
      activeServerId: 'api-server-default',
      message: 'API server is stopped.',
      warnings: [],
      servers: [{
        id: 'api-server-default',
        name: 'Local API Server',
        running: false,
        host: '127.0.0.1',
        port: 17640,
        baseUrl: 'http://127.0.0.1:17640',
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        message: 'API server is stopped.',
        warnings: [],
      }],
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
          route: '/v1/tables/users',
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
          route: '/v1/tables/users',
          status: 200,
          durationMs: 3.1,
          requestBytes: 60,
          responseBytes: 120,
        },
      ],
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
      activeServerId: 'api-server-default',
      startedAt: '2026-06-14T00:00:00.000Z',
      message: 'API server is running.',
      warnings: [],
      servers: [{
        id: 'api-server-default',
        name: 'Local API Server',
        running: true,
        host: '127.0.0.1',
        port: 17640,
        baseUrl: 'http://127.0.0.1:17640',
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        startedAt: '2026-06-14T00:00:00.000Z',
        message: 'API server is running.',
        warnings: [],
      }],
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
      servers: [{
        id: 'api-server-default',
        name: 'Local API Server',
        running: false,
        host: '127.0.0.1',
        port: 17640,
        baseUrl: 'http://127.0.0.1:17640',
        message: 'API server is stopped.',
        warnings: [],
      }],
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
        servers: [{
          id: 'api-server-default',
          name: 'Local API Server',
          host: '127.0.0.1',
          port: 17640,
          autoStart: false,
        }],
      },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Experimental Settings' }))

    expect(props.onOpenExperimentalSettings).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('starts the selected datastore API server and lists generated endpoint routes', async () => {
    const props = renderApiServerWorkspace()

    expect(await screen.findByText('Tables')).toBeInTheDocument()
    expect(screen.getByText('Concrete table CRUD routes are generated from datastore discovery.')).toBeInTheDocument()
    expect(screen.queryByText('GET /health')).not.toBeInTheDocument()
    expect(screen.queryByText('GET /v1/meta')).not.toBeInTheDocument()
    expect(screen.queryByText('GET /v1/resources')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(props.onStart).toHaveBeenCalledWith({
        serverId: 'api-server-default',
        connectionId: 'conn-analytics',
        environmentId: 'env-dev',
        port: 17640,
      })
    })
    expect(await screen.findByText('Running')).toBeInTheDocument()
  })

  it('persists target changes without starting the listener', async () => {
    const props = renderApiServerWorkspace()

    fireEvent.change(screen.getByLabelText('Port'), {
      target: { value: '17641' },
    })
    const saveButton = screen.getByRole('button', { name: 'Save Target' })
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled()
    })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(props.onUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          host: '127.0.0.1',
          port: 17641,
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
        }),
      )
    })
    expect(props.onStart).not.toHaveBeenCalled()
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
        activeServerId: 'api-server-default',
        startedAt: '2026-06-14T00:00:00.000Z',
        message: 'API server is running.',
        warnings: [],
        servers: [{
          id: 'api-server-default',
          name: 'Local API Server',
          running: true,
          host: '127.0.0.1',
          port: 17640,
          baseUrl: 'http://127.0.0.1:17640',
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
          startedAt: '2026-06-14T00:00:00.000Z',
          message: 'API server is running.',
          warnings: [],
        }],
      }),
    })

    fireEvent.click(await screen.findByRole('button', { name: 'OpenAPI' }))
    expect(await screen.findByTitle('API Server OpenAPI documentation')).toHaveAttribute(
      'src',
      'http://127.0.0.1:17640/docs',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Metrics' }))
    expect(await screen.findByText('/v1/tables/users')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(await screen.findByText('GET')).toBeInTheDocument()
    expect(props.onGetLogs).toHaveBeenCalledWith({ limit: 80 })
  })
})
