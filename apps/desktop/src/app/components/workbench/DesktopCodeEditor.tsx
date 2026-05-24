import { useEffect, useMemo, useRef, useState } from 'react'
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
  language,
  theme,
  ariaLabel = 'Query editor',
  completionContext,
  completionProviders = [],
  onRequestCompletionRefresh,
  onChange,
  onDropField,
}: {
  value: string
  language: string
  theme: 'light' | 'dark'
  ariaLabel?: string
  completionContext?: EditorCompletionContext
  completionProviders?: DatastoreCompletionProvider[]
  onRequestCompletionRefresh?(): void
  onChange(value: string): void
  onDropField?(fieldPath: string): void
}) {
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

    const disposable = monacoRuntime.editor.onDidChangeModelContent?.(updateDecorations)
    updateDecorations()

    return () => {
      disposable?.dispose()
      monacoRuntime.editor.deltaDecorations?.(decorationIds, [])
    }
  }, [monacoRuntime, value])

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
    return (
      <textarea
        aria-label={ariaLabel}
        className="editor-textarea"
        value={value}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    <div className="editor-monaco-frame" onDragOver={handleDragOver} onDrop={handleDrop}>
      <LoadedEditor
        height="100%"
        language={language}
        value={value}
        theme={theme === 'light' ? 'vs' : 'vs-dark'}
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
        onMount={(editor, monaco) => setMonacoRuntime({ editor, monaco })}
        onChange={(nextValue) => onChange(nextValue ?? '')}
      />
    </div>
  )
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
