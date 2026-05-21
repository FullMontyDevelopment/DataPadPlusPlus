import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, DragEvent } from 'react'
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
  const [LoadedEditor, setLoadedEditor] = useState<null | ComponentType<{
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
          setLoadedEditor(() => module.default)
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
