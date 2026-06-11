import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RedisConsoleEditor } from '../../../../../../../src/app/components/workbench/datastores/common/keyvalue/RedisConsoleEditor'

describe('RedisConsoleEditor', () => {
  it('renders a native command console instead of a JSON editor', () => {
    render(
      <RedisConsoleEditor
        engineLabel="Redis"
        history={['HGETALL session:1']}
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
    expect(screen.getByLabelText('SCAN command help')).toHaveTextContent(
      'Iterates keys without blocking the server.',
    )
    expect(screen.getByRole('button', { name: 'PING' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HGETALL session:1' })).toBeInTheDocument()
  })

  it('runs with Ctrl+Enter, applies shortcuts, and recalls history', () => {
    const onChange = vi.fn()
    const onRun = vi.fn()
    render(
      <RedisConsoleEditor
        engineLabel="Redis"
        history={['TTL session:1', 'HGETALL session:1']}
        value="PING"
        theme="dark"
        onChange={onChange}
        onRun={onRun}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'HGETALL' }))
    expect(onChange).toHaveBeenCalledWith('HGETALL hash:name')

    fireEvent.click(screen.getByRole('button', { name: 'TTL session:1' }))
    expect(onChange).toHaveBeenCalledWith('TTL session:1')

    fireEvent.keyDown(screen.getByLabelText('Redis command'), {
      key: 'ArrowUp',
    })
    expect(onChange).toHaveBeenCalledWith('TTL session:1')

    fireEvent.keyDown(screen.getByLabelText('Redis command'), {
      key: 'ArrowUp',
    })
    expect(onChange).toHaveBeenCalledWith('HGETALL session:1')

    fireEvent.keyDown(screen.getByLabelText('Redis command'), {
      key: 'ArrowDown',
    })
    expect(onChange).toHaveBeenCalledWith('TTL session:1')

    fireEvent.keyDown(screen.getByLabelText('Redis command'), {
      key: 'Enter',
      ctrlKey: true,
    })
    expect(onRun).toHaveBeenCalled()
  })

  it('toggles pipeline mode and inserts a safe multi-command batch', () => {
    const onChange = vi.fn()
    const onPipelineModeChange = vi.fn()
    render(
      <RedisConsoleEditor
        engineLabel="Redis"
        value={'PING\nDBSIZE'}
        pipelineMode
        theme="dark"
        onChange={onChange}
        onPipelineModeChange={onPipelineModeChange}
        onRun={vi.fn()}
      />,
    )

    expect(screen.getByText('2 command(s)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline' }))
    expect(onPipelineModeChange).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: 'PIPELINE' }))
    expect(onChange).toHaveBeenCalledWith('PING\nDBSIZE\nINFO stats')
  })
})
