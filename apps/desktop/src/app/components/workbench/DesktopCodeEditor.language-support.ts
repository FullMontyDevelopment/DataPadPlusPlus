import { useEffect } from 'react'
import type { MonacoApiLike, MonacoEditorLike } from './intellisense/monaco-completions'

export interface EditorDiagnostic {
  start: number
  end: number
  message: string
  severity: 'error' | 'warning' | 'info'
}

export function useEditorLanguageSupport({
  runtime,
  language,
  value,
  ambientDeclarations,
  buildDiagnostics,
}: {
  runtime?: { editor: MonacoEditorLike; monaco: MonacoApiLike }
  language: string
  value: string
  ambientDeclarations?: string
  buildDiagnostics?(value: string): EditorDiagnostic[]
}) {
  useEffect(() => {
    if (!runtime || language !== 'javascript' || !ambientDeclarations) {
      return undefined
    }
    const defaults = runtime.monaco.languages.typescript?.javascriptDefaults
    defaults?.setCompilerOptions?.({
      allowNonTsExtensions: true,
      checkJs: true,
      target: runtime.monaco.languages.typescript?.ScriptTarget?.ES2022,
      lib: ['es2022'],
    })
    const disposable = defaults?.addExtraLib?.(
      ambientDeclarations,
      'inmemory://datapadplusplus/mongodb-sandbox.d.ts',
    )
    return () => disposable?.dispose()
  }, [ambientDeclarations, language, runtime])

  useEffect(() => {
    const model = runtime?.editor.getModel?.()
    const markerApi = runtime?.monaco.editor?.setModelMarkers
    if (!model?.getPositionAt || !markerApi || !buildDiagnostics) {
      return undefined
    }
    const markers = buildDiagnostics(value).map((diagnostic) => {
      const start = model.getPositionAt?.(diagnostic.start) ?? { lineNumber: 1, column: 1 }
      const end = model.getPositionAt?.(Math.max(diagnostic.start + 1, diagnostic.end)) ?? start
      const severity = diagnostic.severity === 'error'
        ? runtime.monaco.MarkerSeverity?.Error ?? 8
        : diagnostic.severity === 'warning'
          ? runtime.monaco.MarkerSeverity?.Warning ?? 4
          : runtime.monaco.MarkerSeverity?.Info ?? 2
      return {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        message: diagnostic.message,
        severity,
        source: 'DataPad++ MongoDB sandbox',
      }
    })
    markerApi(model, 'datapadplusplus-mongodb-script', markers)
    return () => markerApi(model, 'datapadplusplus-mongodb-script', [])
  }, [buildDiagnostics, runtime, value])
}
