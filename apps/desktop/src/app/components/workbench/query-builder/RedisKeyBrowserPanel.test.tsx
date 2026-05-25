import { act, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type {
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  QueryBuilderState,
  QueryTabState,
  RedisKeyBrowserState,
  RedisKeyScanRequest,
  RedisKeyScanResponse,
} from '@datapadplusplus/shared-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RedisKeyBrowserPanel } from './RedisKeyBrowserPanel'
import {
  buildRedisKeyBrowserQueryText,
  createDefaultRedisKeyBrowserState,
} from './redis-key-browser'

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
    expect(onBuilderStateChange).not.toHaveBeenCalled()
    expect(screen.getByText('Scan more')).toBeInTheDocument()
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

  it('confirms key deletion in-app before executing a Redis edit', async () => {
    vi.useFakeTimers()
    const onExecuteDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
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
    }))
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

    expect(screen.getByRole('dialog', { name: 'Delete Redis key perf:1?' })).toBeInTheDocument()
    expect(onExecuteDataEdit).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
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
    expect(screen.queryByRole('button', { name: 'Delete perf:1' })).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

function RedisHarness({
  onBuilderStateChange,
  onExecuteDataEdit,
  onScanRedisKeys,
}: {
  onBuilderStateChange(tabId: string, builderState: QueryBuilderState): void
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
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
