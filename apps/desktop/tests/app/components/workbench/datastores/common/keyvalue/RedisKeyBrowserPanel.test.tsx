import { act, useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type {
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  QueryBuilderState,
  QueryTabState,
  RedisKeyBrowserState,
  RedisKeyInspectRequest,
  RedisKeyScanRequest,
  RedisKeyScanResponse,
} from '@datapadplusplus/shared-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RedisKeyBrowserPanel } from '../../../../../../../src/app/components/workbench/datastores/common/keyvalue/RedisKeyBrowserPanel'
import {
  buildRedisKeyBrowserQueryText,
  createDefaultRedisKeyBrowserState,
} from '../../../../../../../src/app/components/workbench/query-builder/redis-key-browser'

describe('RedisKeyBrowserPanel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('scans once on initial render without writing scan cursor state back to the builder', async () => {
    vi.useFakeTimers()
    const onBuilderStateChange = vi.fn()
    const onScanRedisKeys = vi.fn<() => Promise<RedisKeyScanResponse | undefined>>(
      async () => redisScanResponse({ nextCursor: '42' }),
    )

    render(
      <RedisHarness
        onBuilderStateChange={onBuilderStateChange}
        onScanRedisKeys={onScanRedisKeys}
      />,
    )

    await flushDebouncedScan()

    expect(onScanRedisKeys).toHaveBeenCalledTimes(1)
    expect(onScanRedisKeys).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryMode: 'fast',
      }),
    )
    expect(onBuilderStateChange).not.toHaveBeenCalled()
    expect(screen.getByText('Scan more')).toBeInTheDocument()
  })

  it('does not show a local loading word while scan is pending', async () => {
    vi.useFakeTimers()
    const onScanRedisKeys = vi.fn(
      async () => new Promise<RedisKeyScanResponse>(() => {}),
    )

    render(
      <RedisHarness
        onBuilderStateChange={vi.fn()}
        onScanRedisKeys={onScanRedisKeys}
      />,
    )

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })

    expect(onScanRedisKeys).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })

  it('debounces pattern changes and scans once for the new criteria', async () => {
    vi.useFakeTimers()
    const onBuilderStateChange = vi.fn()
    const onScanRedisKeys = vi.fn(async (request: RedisKeyScanRequest) =>
      redisScanResponse({
        nextCursor: request.pattern === 'orders:*' ? '0' : '42',
      }),
    )

    render(
      <RedisHarness
        onBuilderStateChange={onBuilderStateChange}
        onScanRedisKeys={onScanRedisKeys}
      />,
    )

    await flushDebouncedScan()

    fireEvent.change(screen.getByLabelText('Filter by key name or pattern'), {
      target: { value: 'orders:*' },
    })

    await act(async () => {
      vi.advanceTimersByTime(249)
      await Promise.resolve()
    })
    expect(onScanRedisKeys).toHaveBeenCalledTimes(1)

    await flushDebouncedScan()
    await flushDebouncedScan()

    expect(onScanRedisKeys).toHaveBeenCalledTimes(2)
    expect(onScanRedisKeys).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: '0',
        pattern: 'orders:*',
      }),
    )
    expect(onBuilderStateChange).toHaveBeenCalledTimes(1)
  })

  it('uses the local cursor for Scan more without rewriting builder state', async () => {
    vi.useFakeTimers()
    const onBuilderStateChange = vi.fn()
    const onScanRedisKeys = vi.fn(async (request: RedisKeyScanRequest) =>
      redisScanResponse({
        key: request.cursor === '42' ? 'perf:2' : 'perf:1',
        nextCursor: request.cursor === '42' ? '0' : '42',
      }),
    )

    render(
      <RedisHarness
        onBuilderStateChange={onBuilderStateChange}
        onScanRedisKeys={onScanRedisKeys}
      />,
    )

    await flushDebouncedScan()
    fireEvent.click(screen.getByText('Scan more'))
    await flushPromises()

    expect(onScanRedisKeys).toHaveBeenCalledTimes(2)
    expect(onScanRedisKeys).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: '42',
      }),
    )
    expect(onBuilderStateChange).not.toHaveBeenCalled()
  })

  it('passes the selected Redis database to key inspection', async () => {
    vi.useFakeTimers()
    const onInspectRedisKey = vi.fn(async () => {})

    render(
      <RedisHarness
        onBuilderStateChange={vi.fn()}
        onInspectRedisKey={onInspectRedisKey}
        onScanRedisKeys={vi.fn(async () => redisScanResponse())}
      />,
    )

    await flushDebouncedScan()
    fireEvent.change(screen.getByLabelText('Redis database index'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    fireEvent.click(screen.getByRole('button', { name: 'perf:1' }))
    await flushPromises()

    expect(onInspectRedisKey).toHaveBeenCalledTimes(1)
    expect(onInspectRedisKey).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseIndex: 1,
        key: 'perf:1',
      }),
    )
  })

  it('does not launch duplicate inspect requests while the same key is pending', async () => {
    vi.useFakeTimers()
    let resolveInspect: (() => void) | undefined
    const pendingInspect = new Promise<void>((resolve) => {
      resolveInspect = resolve
    })
    const onInspectRedisKey = vi.fn(() => pendingInspect)

    render(
      <RedisHarness
        onBuilderStateChange={vi.fn()}
        onInspectRedisKey={onInspectRedisKey}
        onScanRedisKeys={vi.fn(async () => redisScanResponse())}
      />,
    )

    await flushDebouncedScan()
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    const keyButton = screen.getByRole('button', { name: 'perf:1' })
    fireEvent.click(keyButton)
    fireEvent.click(keyButton)
    await flushPromises()

    expect(onInspectRedisKey).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveInspect?.()
      await pendingInspect
    })
    fireEvent.click(keyButton)
    await flushPromises()

    expect(onInspectRedisKey).toHaveBeenCalledTimes(2)
  })

  it('passes JSON-looking Redis keys through exactly as selected', async () => {
    vi.useFakeTimers()
    const jsonLikeKey = '{"pin_SearchFor":"LOOKUP","pin_SearchWith":"KEY:FOUND"}'
    const onInspectRedisKey = vi.fn(async () => {})

    render(
      <RedisHarness
        onBuilderStateChange={vi.fn()}
        onInspectRedisKey={onInspectRedisKey}
        onScanRedisKeys={vi.fn(async () => redisScanResponse({ key: jsonLikeKey }))}
      />,
    )

    await flushDebouncedScan()
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    fireEvent.click(screen.getByRole('button', { name: jsonLikeKey }))
    await flushPromises()

    expect(onInspectRedisKey).toHaveBeenCalledTimes(1)
    expect(onInspectRedisKey).toHaveBeenCalledWith(
      expect.objectContaining({
        key: jsonLikeKey,
      }),
    )
  })

  it('toggles prefix rows without inspecting a Redis key', async () => {
    vi.useFakeTimers()
    const onInspectRedisKey = vi.fn(async () => {})

    render(
      <RedisHarness
        onBuilderStateChange={vi.fn()}
        onInspectRedisKey={onInspectRedisKey}
        onScanRedisKeys={vi.fn(async () => redisScanResponse({ key: 'orders:recent:1' }))}
      />,
    )

    await flushDebouncedScan()
    const treegrid = screen.getByRole('treegrid')
    fireEvent.click(within(treegrid).getByRole('button', { name: /orders/ }))
    await flushPromises()

    expect(within(treegrid).getByRole('button', { name: /recent/ })).toBeInTheDocument()
    expect(onInspectRedisKey).not.toHaveBeenCalled()
  })

  it('sends key deletion straight to the guarded Redis edit flow', async () => {
    vi.useFakeTimers()
    const onExecuteDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => redisDeleteResponse())
    const confirmSpy = vi.spyOn(window, 'confirm')

    render(
      <RedisHarness
        onBuilderStateChange={vi.fn()}
        onExecuteDataEdit={onExecuteDataEdit}
        onScanRedisKeys={vi.fn(async () => redisScanResponse())}
      />,
    )

    await flushDebouncedScan()
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete perf:1' }))
    await flushPromises()

    expect(onExecuteDataEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'delete-key',
        changes: [],
        target: expect.objectContaining({
          objectKind: 'key',
          key: 'perf:1',
        }),
      }),
    )
    expect(screen.queryByRole('dialog', { name: /Delete Redis key/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete perf:1' })).not.toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('deletes visible tree keys without an extra browser confirmation', async () => {
    vi.useFakeTimers()
    const onExecuteDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => redisDeleteResponse())

    render(
      <RedisHarness
        onBuilderStateChange={vi.fn()}
        onExecuteDataEdit={onExecuteDataEdit}
        onScanRedisKeys={vi.fn(async () => redisScanResponse())}
      />,
    )

    await flushDebouncedScan()
    const treegrid = screen.getByRole('treegrid')
    fireEvent.click(within(treegrid).getByRole('button', { name: /perf/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete perf:1' }))
    await flushPromises()

    expect(onExecuteDataEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        editKind: 'delete-key',
        target: expect.objectContaining({
          objectKind: 'key',
          key: 'perf:1',
        }),
      }),
    )
    expect(screen.queryByRole('dialog', { name: /Delete Redis key/ })).not.toBeInTheDocument()
  })

  it('reports Redis delete guardrail blocks without opening a second confirmation dialog', async () => {
    vi.useFakeTimers()
    const onExecuteDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> =>
      redisDeleteConfirmationRequiredResponse(),
    )

    render(
      <RedisHarness
        onBuilderStateChange={vi.fn()}
        onExecuteDataEdit={onExecuteDataEdit}
        onScanRedisKeys={vi.fn(async () => redisScanResponse())}
      />,
    )

    await flushDebouncedScan()
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete perf:1' }))
    await flushPromises()

    expect(onExecuteDataEdit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: /Delete this Redis key/ })).not.toBeInTheDocument()
    expect(screen.getByText('This data edit needs confirmation before it can run.')).toBeInTheDocument()
  })
})

function RedisHarness({
  onBuilderStateChange,
  onExecuteDataEdit,
  onInspectRedisKey,
  onScanRedisKeys,
}: {
  onBuilderStateChange(tabId: string, builderState: QueryBuilderState): void
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onInspectRedisKey?(request: RedisKeyInspectRequest): Promise<void>
  onScanRedisKeys(request: RedisKeyScanRequest): Promise<RedisKeyScanResponse | undefined>
}) {
  const [builderState, setBuilderState] = useState<RedisKeyBrowserState>(
    createDefaultRedisKeyBrowserState('perf:*', 100),
  )
  const tab: QueryTabState = {
    id: 'tab-redis',
    title: 'Redis Browser',
    connectionId: 'conn-redis',
    environmentId: 'env-dev',
    family: 'keyvalue',
    language: 'redis',
    editorLabel: 'Redis / dev',
    queryText: buildRedisKeyBrowserQueryText(builderState),
    queryViewMode: 'builder',
    builderState,
    status: 'idle',
    dirty: false,
    history: [],
  }

  return (
    <RedisKeyBrowserPanel
      tab={tab}
      builderState={builderState}
      onBuilderStateChange={(tabId, nextState) => {
        setBuilderState(nextState as RedisKeyBrowserState)
        onBuilderStateChange(tabId, nextState)
      }}
      onExecuteDataEdit={onExecuteDataEdit}
      onInspectRedisKey={onInspectRedisKey}
      onScanRedisKeys={onScanRedisKeys}
    />
  )
}

async function flushDebouncedScan() {
  await act(async () => {
    vi.advanceTimersByTime(250)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function redisScanResponse({
  key = 'perf:1',
  nextCursor = '0',
}: {
  key?: string
  nextCursor?: string
} = {}): RedisKeyScanResponse {
  return {
    connectionId: 'conn-redis',
    environmentId: 'env-dev',
    databaseIndex: 0,
    cursor: '0',
    nextCursor,
    scannedCount: 100,
    keys: [
      {
        key,
        type: 'hash',
        ttlLabel: 'No limit',
        memoryUsageLabel: '144 B',
        length: 4,
      },
    ],
    usedTypeFilterFallback: false,
    moduleTypes: [],
    warnings: [],
  }
}

function redisDeleteResponse(): DataEditExecutionResponse {
  return {
    connectionId: 'conn-redis',
    environmentId: 'env-dev',
    editKind: 'delete-key',
    executionSupport: 'live',
    executed: true,
    plan: {
      operationId: 'redis.data-edit.delete-key',
      engine: 'redis',
      summary: 'Deleted key.',
      generatedRequest: 'DEL perf:1',
      requestLanguage: 'redis',
      destructive: true,
      requiredPermissions: ['delete redis key'],
      warnings: [],
    },
    messages: ['Deleted key.'],
    warnings: [],
  }
}

function redisDeleteConfirmationRequiredResponse(): DataEditExecutionResponse {
  return {
    ...redisDeleteResponse(),
    executed: false,
    plan: {
      ...redisDeleteResponse().plan,
      confirmationText: 'CONFIRM QA',
      warnings: ['This data edit needs confirmation before it can run.'],
    },
    messages: [],
    warnings: ['This data edit needs confirmation before it can run.'],
  }
}
