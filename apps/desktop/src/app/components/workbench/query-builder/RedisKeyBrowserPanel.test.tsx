import { act, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type {
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
})

function RedisHarness({
  onBuilderStateChange,
  onScanRedisKeys,
}: {
  onBuilderStateChange(tabId: string, builderState: QueryBuilderState): void
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
