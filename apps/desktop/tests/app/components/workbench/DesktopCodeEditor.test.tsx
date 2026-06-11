import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatastoreCompletionProvider, EditorCompletionContext } from '../../../../src/app/components/workbench/intellisense/types'
import { DesktopCodeEditor } from '../../../../src/app/components/workbench/DesktopCodeEditor'

const registerCompletionItemProvider = vi.fn()
const dispose = vi.fn()
const addCommand = vi.fn()
const trigger = vi.fn()
let selectedText = ''
let cursorSelectionHandler: (() => void) | undefined

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  function MonacoEditorMock({
    value,
    onChange,
    onMount,
  }: {
    value: string
    onChange(value: string | undefined): void
    onMount?(editor: unknown, monaco: unknown): void
  }) {
    React.useEffect(() => {
      onMount?.(
        {
          addCommand,
          trigger,
          getSelection: () => ({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: selectedText.length + 1,
          }),
          getModel: () => ({
            getValue: () => value,
            getValueInRange: () => selectedText,
            getPositionAt: () => ({ lineNumber: 1, column: 1 }),
          }),
          onDidChangeCursorSelection: (handler: () => void) => {
            cursorSelectionHandler = handler
            return { dispose }
          },
        },
        {
          KeyMod: { CtrlCmd: 2048 },
          KeyCode: { Space: 10 },
          languages: {
            CompletionItemKind: {
              Keyword: 1,
              Field: 2,
              Class: 3,
              Text: 4,
            },
            registerCompletionItemProvider,
          },
        },
      )
    }, [onMount, value])

    return (
      <textarea
        aria-label="Query editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return {
    default: MonacoEditorMock,
  }
})

describe('DesktopCodeEditor', () => {
  beforeEach(() => {
    selectedText = ''
    cursorSelectionHandler = undefined
    vi.clearAllMocks()
  })

  it('registers and disposes Monaco completion providers', async () => {
    registerCompletionItemProvider.mockReturnValue({ dispose })
    const provider: DatastoreCompletionProvider = {
      id: 'test-provider',
      languages: ['sql'],
      buildItems: () => [
        {
          label: 'accounts',
          insertText: 'accounts',
          kind: 'table',
        },
      ],
    }
    const context: EditorCompletionContext = {
      language: 'sql',
      queryText: 'select * from ',
      catalog: {
        schemas: [],
        objects: [],
        fields: [],
        commands: [],
        operators: [],
        functions: [],
        snippets: [],
        loadedAt: '2026-05-17T00:00:00.000Z',
        stale: false,
        sources: ['test'],
      },
    }

    const { unmount } = render(
      <DesktopCodeEditor
        value="select * from "
        language="sql"
        theme="dark"
        completionContext={context}
        completionProviders={[provider]}
        onChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(registerCompletionItemProvider).toHaveBeenCalledWith(
        'sql',
        expect.objectContaining({
          triggerCharacters: expect.arrayContaining(['.', '"']),
        }),
      )
    })

    const registration = registerCompletionItemProvider.mock.calls[0]?.[1] as {
      provideCompletionItems(model: unknown, position: unknown): {
        suggestions: Array<{ label: string; insertText: string }>
      }
    }
    const result = registration.provideCompletionItems(
      {
        getValue: () => 'select * from ',
        getOffsetAt: () => 14,
        getWordUntilPosition: () => ({ word: '', startColumn: 15, endColumn: 15 }),
      },
      { lineNumber: 1, column: 15 },
    )

    expect(result.suggestions).toEqual([
      expect.objectContaining({ label: 'accounts', insertText: 'accounts' }),
    ])

    unmount()

    expect(dispose).toHaveBeenCalled()
    expect(addCommand).toHaveBeenCalled()
  })

  it('keeps the textarea fallback editable while Monaco loads', () => {
    const onChange = vi.fn()
    render(
      <DesktopCodeEditor
        value="select 1;"
        language="sql"
        theme="dark"
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Query editor'), {
      target: { value: 'select 2;' },
    })

    expect(onChange).toHaveBeenCalledWith('select 2;')
  })

  it('keeps Monaco keystrokes local when the parent rerenders with a stale value', async () => {
    const onChange = vi.fn()

    function Harness() {
      const [renderCount, setRenderCount] = useState(0)

      return (
        <>
          <button type="button" onClick={() => setRenderCount((count) => count + 1)}>
            rerender {renderCount}
          </button>
          <DesktopCodeEditor
            value="select 1;"
            language="sql"
            theme="dark"
            onChange={onChange}
          />
        </>
      )
    }

    render(<Harness />)

    const editor = await screen.findByLabelText('Query editor')
    fireEvent.change(editor, {
      target: { value: 'select 123;' },
    })

    expect(editor).toHaveValue('select 123;')
    fireEvent.click(screen.getByRole('button', { name: /rerender/i }))

    expect(editor).toHaveValue('select 123;')
  })

  it('reports highlighted Monaco text for run selection', async () => {
    const onSelectionChange = vi.fn()
    render(
      <DesktopCodeEditor
        value="select 1; select 2;"
        language="sql"
        theme="dark"
        onChange={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    )

    await waitFor(() => expect(cursorSelectionHandler).toBeDefined())
    selectedText = 'select 2;'
    cursorSelectionHandler?.()

    expect(onSelectionChange).toHaveBeenLastCalledWith('select 2;')
  })
})
