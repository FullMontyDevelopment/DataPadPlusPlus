import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ElementType } from 'react'
import {
  acceptFieldDrag,
  clearFieldDragData,
  readFieldDragData,
} from './results/field-drag'
import {
  registerDatastoreCompletionProvider,
  type MonacoApiLike,
  type MonacoDisposableLike,
  type MonacoEditorLike,
} from './intellisense/monaco-completions'
import type {
  DatastoreCompletionProvider,
  EditorCompletionContext,
} from './intellisense/types'
import { variableDefinitionsForEnvironment } from '../../state/environment-variables'

export function DesktopCodeEditor({
  value,
  resetKey,
  language,
  theme,
  ariaLabel = 'Query editor',
  completionContext,
  completionProviders = [],
  onRequestCompletionRefresh,
  onChange,
  onSelectionChange,
  onDropField,
}: {
  value: string
  resetKey?: string | number
  language: string
  theme: string
  ariaLabel?: string
  completionContext?: EditorCompletionContext
  completionProviders?: DatastoreCompletionProvider[]
  onRequestCompletionRefresh?(): void
  onChange(value: string): void
  onSelectionChange?(selectedText: string): void
  onDropField?(fieldPath: string): void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [localValue, setLocalValue] = useState(value)
  const localValueRef = useRef(value)
  const lastExternalValueRef = useRef(value)
  const lastEmittedValueRef = useRef(value)
  const lastResetKeyRef = useRef(resetKey)
  const completionRef = useRef({
    completionContext,
    completionProviders,
    onRequestCompletionRefresh,
  })
  const [monacoRuntime, setMonacoRuntime] = useState<
    | {
        editor: MonacoEditorLike
        monaco: MonacoApiLike
      }
    | undefined
  >()
  const [LoadedEditor, setLoadedEditor] = useState<null | ElementType<{
    height: string
    language: string
    value: string
    theme: string
    options: Record<string, unknown>
    onChange(value: string | undefined): void
    onMount?(editor: MonacoEditorLike, monaco: MonacoApiLike): void
  }>>(null)
  const completionProviderCount = completionProviders.length
  const hasCompletionContext = Boolean(completionContext)
  const completionRegistrationKey = useMemo(
    () => `${language}:${completionProviderCount}:${hasCompletionContext ? 'on' : 'off'}`,
    [completionProviderCount, hasCompletionContext, language],
  )

  useEffect(() => {
    localValueRef.current = localValue
  }, [localValue])

  useEffect(() => {
    if (value === lastExternalValueRef.current && resetKey === lastResetKeyRef.current) {
      return
    }

    lastExternalValueRef.current = value
    lastResetKeyRef.current = resetKey
    if (value !== localValueRef.current) {
      lastEmittedValueRef.current = value
      setLocalValue(value)
    }
  }, [resetKey, value])

  const handleValueChange = useCallback(
    (nextValue: string | undefined) => {
      const resolvedValue = nextValue ?? ''
      lastEmittedValueRef.current = resolvedValue
      setLocalValue(resolvedValue)
      onChange(resolvedValue)
    },
    [onChange],
  )
  const handleMonacoMount = useCallback(
    (editor: MonacoEditorLike, monaco: MonacoApiLike) => {
      setMonacoRuntime((current) =>
        current?.editor === editor && current.monaco === monaco
          ? current
          : { editor, monaco },
      )
      onSelectionChange?.(readMonacoSelection(editor))
    },
    [onSelectionChange],
  )

  useEffect(() => {
    let mounted = true

    void import('@monaco-editor/react')
      .then((module) => {
        if (mounted) {
          setLoadedEditor(() => module.default as ElementType<{
            height: string
            language: string
            value: string
            theme: string
            options: Record<string, unknown>
            onChange(value: string | undefined): void
            onMount?(editor: MonacoEditorLike, monaco: MonacoApiLike): void
          }>)
        }
      })
      .catch(() => {
        if (mounted) {
          setLoadedEditor(null)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    completionRef.current = {
      completionContext,
      completionProviders,
      onRequestCompletionRefresh,
    }
  }, [completionContext, completionProviders, onRequestCompletionRefresh])

  useEffect(() => {
    if (!monacoRuntime?.editor || !onSelectionChange) {
      return undefined
    }

    const reportSelection = () => {
      onSelectionChange(readMonacoSelection(monacoRuntime.editor))
    }
    const disposable = monacoRuntime.editor.onDidChangeCursorSelection?.(reportSelection)
    reportSelection()

    return () => disposable?.dispose()
  }, [monacoRuntime, onSelectionChange])

  useEffect(() => {
    if (!monacoRuntime || !hasCompletionContext || completionProviderCount === 0) {
      return undefined
    }

    const disposable: MonacoDisposableLike = registerDatastoreCompletionProvider({
      ...monacoRuntime,
      language,
      getContext: () => completionRef.current.completionContext,
      getProviders: () => completionRef.current.completionProviders,
      onRequestCompletionRefresh: () =>
        completionRef.current.onRequestCompletionRefresh?.(),
    })

    return () => disposable.dispose()
  }, [completionProviderCount, completionRegistrationKey, hasCompletionContext, language, monacoRuntime])

  useEffect(() => {
    if (!monacoRuntime?.editor.deltaDecorations || !monacoRuntime.editor.getModel) {
      return undefined
    }

    let decorationIds: string[] = []
    let animationFrame = 0
    const updateDecorations = () => {
      const model = monacoRuntime.editor.getModel?.()

      if (!model?.getPositionAt) {
        return
      }

      decorationIds =
        monacoRuntime.editor.deltaDecorations?.(
          decorationIds,
          variableDecorations(model, completionRef.current.completionContext),
        ) ?? []
    }
    const scheduleUpdateDecorations = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        updateDecorations()
      })
    }

    const disposable = monacoRuntime.editor.onDidChangeModelContent?.(scheduleUpdateDecorations)
    updateDecorations()

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      disposable?.dispose()
      monacoRuntime.editor.deltaDecorations?.(decorationIds, [])
    }
  }, [monacoRuntime])

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!onDropField) {
      return
    }

    acceptFieldDrag(event)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!onDropField) {
      return
    }

    event.preventDefault()
    const fieldPath = readFieldDragData(event)

    if (fieldPath) {
      onDropField(fieldPath)
    }

    clearFieldDragData()
  }

  if (!LoadedEditor) {
    const reportTextareaSelection = () => {
      const textarea = textareaRef.current
      if (!textarea || !onSelectionChange) {
        return
      }

      onSelectionChange(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd))
    }

    return (
      <textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        className="editor-textarea"
        value={localValue}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onKeyUp={reportTextareaSelection}
        onMouseUp={reportTextareaSelection}
        onSelect={reportTextareaSelection}
        onChange={(event) => handleValueChange(event.target.value)}
      />
    )
  }

  return (
    <div className="editor-monaco-frame" onDragOver={handleDragOver} onDrop={handleDrop}>
      <LoadedEditor
        height="100%"
        language={language}
        value={localValue}
        theme={monacoThemeForWorkbenchTheme(theme)}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          lineNumbersMinChars: 3,
          padding: { top: 12 },
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
        }}
        onMount={handleMonacoMount}
        onChange={handleValueChange}
      />
    </div>
  )
}

function readMonacoSelection(editor: MonacoEditorLike) {
  const selection = editor.getSelection?.()
  const model = editor.getModel?.()

  if (!selection || !model?.getValueInRange) {
    return ''
  }

  return model.getValueInRange(selection)
}

function monacoThemeForWorkbenchTheme(theme: string) {
  return theme === 'light' || theme === 'solarized-light' ? 'vs' : 'vs-dark'
}

function variableDecorations(
  model: {
    getValue(): string
    getPositionAt?(offset: number): { lineNumber: number; column: number }
  },
  context: EditorCompletionContext | undefined,
) {
  const text = model.getValue()
  const positionAt = model.getPositionAt

  if (!positionAt) {
    return []
  }

  const definitions = new Map(
    context?.environment
      ? variableDefinitionsForEnvironment(context.environment).map((definition) => [
          definition.key,
          definition,
        ])
      : [],
  )
  const decorations: Array<{
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
    options: { inlineClassName: string; hoverMessage?: { value: string } }
  }> = []
  const tokenPattern = /\{\{([A-Z_][A-Z0-9_]*)\}\}|\$\{([A-Z_][A-Z0-9_]*)\}/g

  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const key = match[1] ?? match[2] ?? ''
    const definition = definitions.get(key)
    const legacy = match[0].startsWith('${')
    const startPosition = positionAt(start)
    const endPosition = positionAt(end)
    const className = legacy
      ? 'editor-env-token editor-env-token--legacy'
      : !definition
        ? 'editor-env-token editor-env-token--unresolved'
        : definition.kind === 'secret'
          ? 'editor-env-token editor-env-token--secret'
          : 'editor-env-token editor-env-token--text'

    decorations.push({
      range: {
        startLineNumber: startPosition.lineNumber,
        startColumn: startPosition.column,
        endLineNumber: endPosition.lineNumber,
        endColumn: endPosition.column,
      },
      options: {
        inlineClassName: className,
        hoverMessage: {
          value: legacy
            ? 'Legacy variable syntax. Use `{{VAR_NAME}}`.'
            : definition?.kind === 'secret'
              ? 'Secret environment variable. Resolved only when used.'
              : definition
                ? 'Environment variable.'
                : 'Unresolved environment variable.',
        },
      },
    })
  }

  return decorations
}
