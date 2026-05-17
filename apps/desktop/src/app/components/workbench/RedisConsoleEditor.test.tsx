import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RedisConsoleEditor } from './RedisConsoleEditor'

describe('RedisConsoleEditor', () => {
  it('renders a native command console instead of a JSON editor', () => {
    render(
      <RedisConsoleEditor
        engineLabel="Redis"
        value="SCAN 0 MATCH * COUNT 100"
        theme="dark"
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Redis command console')).toBeInTheDocument()
    expect(screen.getByLabelText('Redis command')).toHaveValue(
      'SCAN 0 MATCH * COUNT 100',
    )
    expect(screen.getByRole('button', { name: 'PING' })).toBeInTheDocument()
  })

  it('runs with Ctrl+Enter and applies command shortcuts', () => {
    const onChange = vi.fn()
    const onRun = vi.fn()
    render(
      <RedisConsoleEditor
        engineLabel="Redis"
        value="PING"
        theme="dark"
        onChange={onChange}
        onRun={onRun}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'HGETALL' }))
    expect(onChange).toHaveBeenCalledWith('HGETALL hash:name')

    fireEvent.keyDown(screen.getByLabelText('Redis command'), {
      key: 'Enter',
      ctrlKey: true,
    })
    expect(onRun).toHaveBeenCalled()
  })
})
