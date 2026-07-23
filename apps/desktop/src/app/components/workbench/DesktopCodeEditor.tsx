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
import {
  monacoThemeForWorkbenchTheme,
  readMonacoSelection,
  variableDecorations,
} from './DesktopCodeEditor.helpers'
import {
  useEditorLanguageSupport,
  type EditorDiagnostic,
} from './DesktopCodeEditor.language-support'

export type { EditorDiagnostic } from './DesktopCodeEditor.language-support'

export interface EditorInsertionRequest {
  id: string
  text: string
}

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
  insertionRequest,
  ambientDeclarations,
  buildDiagnostics,
  readOnly = false,
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
  insertionRequest?: EditorInsertionRequest
  ambientDeclarations?: string
  buildDiagnostics?(value: string): EditorDiagnostic[]
  readOnly?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [localValue, setLocalValue] = useState(value)
  const localValueRef = useRef(value)
  const lastExternalValueRef = useRef(value)
  const lastResetKeyRef = useRef(resetKey)
  const completionRef = useRef({
    completionContext,
    completionProviders,
    onRequestCompletionRefresh,
  })
  const pendingCompletionCatalogRef = useRef<string | undefined>(undefined)
  const appliedInsertionRef = useRef<string | undefined>(undefined)
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
    const previousExternalValue = lastExternalValueRef.current
    const resetChanged = resetKey !== lastResetKeyRef.current

    if (value === previousExternalValue && !resetChanged) {
      return
    }

    lastExternalValueRef.current = value
    lastResetKeyRef.current = resetKey

    if (value === localValueRef.current) {
      return
    }

    const hasNewerLocalValue = localValueRef.current !== previousExternalValue
    if (resetChanged || !hasNewerLocalValue) {
      localValueRef.current = value
      setLocalValue(value)
    }
  }, [resetKey, value])

  const handleValueChange = useCallback(
    (nextValue: string | undefined) => {
      if (readOnly) {
        return
      }
      const resolvedValue = nextValue ?? ''
      localValueRef.current = resolvedValue
      setLocalValue(resolvedValue)
      onChange(resolvedValue)
    },
    [onChange, readOnly],
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
    if (readOnly || !insertionRequest || appliedInsertionRef.current === insertionRequest.id) {
      return
    }

    appliedInsertionRef.current = insertionRequest.id
    const editor = monacoRuntime?.editor
    const position = editor?.getPosition?.()
    if (editor?.executeEdits && position) {
      editor.pushUndoStop?.()
      editor.executeEdits('mongodb-script-guide', [{
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
        text: insertionRequest.text,
        forceMoveMarkers: true,
      }])
      editor.pushUndoStop?.()
      editor.focus?.()
      return
    }

    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? localValueRef.current.length
    const end = textarea?.selectionEnd ?? start
    const separator = start > 0 && !localValueRef.current.slice(0, start).endsWith('\n') ? '\n' : ''
    const nextValue = `${localValueRef.current.slice(0, start)}${separator}${insertionRequest.text}${localValueRef.current.slice(end)}`
    handleValueChange(nextValue)
    window.requestAnimationFrame(() => {
      const nextPosition = start + separator.length + insertionRequest.text.length
      textareaRef.current?.setSelectionRange(nextPosition, nextPosition)
      textareaRef.current?.focus()
    })
  }, [handleValueChange, insertionRequest, monacoRuntime, readOnly])

  useEffect(() => {
    if (!monacoRuntime || !hasCompletionContext || completionProviderCount === 0) {
      return undefined
    }

    const disposable: MonacoDisposableLike = registerDatastoreCompletionProvider({
      ...monacoRuntime,
      language,
      getContext: () => completionRef.current.completionContext,
      getProviders: () => completionRef.current.completionProviders,
      onRequestCompletionRefresh: () => {
        pendingCompletionCatalogRef.current =
          completionRef.current.completionContext?.catalog.loadedAt
        completionRef.current.onRequestCompletionRefresh?.()
      },
    })

    return () => disposable.dispose()
  }, [completionProviderCount, completionRegistrationKey, hasCompletionContext, language, monacoRuntime])

  useEffect(() => {
    const requestedCatalog = pendingCompletionCatalogRef.current
    const loadedCatalog = completionContext?.catalog.loadedAt

    if (!requestedCatalog || !loadedCatalog || requestedCatalog === loadedCatalog) {
      return
    }

    pendingCompletionCatalogRef.current = undefined
    monacoRuntime?.editor.trigger?.(
      'datapadplusplus-intellisense',
      'editor.action.triggerSuggest',
      {},
    )
  }, [completionContext?.catalog.loadedAt, monacoRuntime])

  useEditorLanguageSupport({
    runtime: monacoRuntime,
    language,
    value: localValue,
    ambientDeclarations,
    buildDiagnostics,
  })

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
    if (readOnly || !onDropField) {
      return
    }

    acceptFieldDrag(event)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (readOnly || !onDropField) {
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
        aria-readonly={readOnly}
        className="editor-textarea"
        readOnly={readOnly}
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
          readOnly,
          domReadOnly: readOnly,
        }}
        onMount={handleMonacoMount}
        onChange={handleValueChange}
      />
    </div>
  )
}
