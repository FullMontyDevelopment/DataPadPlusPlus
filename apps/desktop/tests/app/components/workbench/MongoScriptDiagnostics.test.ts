import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import ts from 'typescript'
import { variableDecorations } from '../../../../src/app/components/workbench/DesktopCodeEditor.helpers'
import { MONGO_SCRIPT_DECLARATIONS } from '../../../../src/app/components/workbench/datastores/mongodb/mongo-script-language'
import { useEditorLanguageSupport } from '../../../../src/app/components/workbench/DesktopCodeEditor.language-support'
import type { MonacoApiLike } from '../../../../src/app/components/workbench/intellisense/monaco-completions'

function errors(source: string) {
  const files: Record<string, string> = { 'script.js': source, 'sandbox.d.ts': MONGO_SCRIPT_DECLARATIONS }
  const options: ts.CompilerOptions = { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], moduleDetection: ts.ModuleDetectionKind.Force }
  const host = ts.createCompilerHost(options)
  const readSource = host.getSourceFile.bind(host)
  host.getSourceFile = (file, version, onError, fresh) => file in files ? ts.createSourceFile(file, files[file], version, true) : readSource(file, version, onError, fresh)
  const program = ts.createProgram(Object.keys(files), options, host)
  return ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('MongoDB script diagnostics', () => {
  it('does not mark JavaScript template expressions as environment variables', () => {
    const model = { getValue: () => 'print(`${NAME} {{REGION}}`)',
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }) }
    expect(variableDecorations(model, undefined, 'javascript')).toHaveLength(1)
    expect(variableDecorations(model, undefined, 'sql')).toHaveLength(2)
  })

  it('reports missing functions, unsupported helpers, and syntax errors', () => {
    expect(errors('missingFunction();')).toEqual(expect.arrayContaining([expect.stringContaining('missingFunction')]))
    expect(errors('db.products.nonexistent();')).toEqual(expect.arrayContaining([expect.stringContaining('nonexistent')]))
    expect(errors('const value = ;')).toEqual(expect.arrayContaining([expect.stringContaining('Expression expected')]))
  })

  it('accepts the supported sandbox API, collection shorthand and native template literals', () => {
    expect(errors('const NAME = db.getName(); print(`${NAME}: ${db.products.countDocuments({})}`); db.getSiblingDB("catalog").getCollectionNames().forEach(name => print(name)); db.runCommand({collStats: "products"});')).toEqual([])
  })

  it.each(['current', 'legacy'])('enables semantic and syntax validation using the %s Monaco API', variant => {
    const setDiagnosticsOptions = vi.fn()
    const dispose = vi.fn()
    const typescript = { javascriptDefaults: { setCompilerOptions: vi.fn(), setDiagnosticsOptions, addExtraLib: vi.fn(() => ({ dispose })) } }
    const monaco = (variant === 'current' ? { languages: {}, typescript } : { languages: { typescript } }) as unknown as MonacoApiLike
    const { unmount } = renderHook(() => useEditorLanguageSupport({ runtime: { editor: {}, monaco }, language: 'javascript', value: '', ambientDeclarations: MONGO_SCRIPT_DECLARATIONS }))
    expect(setDiagnosticsOptions).toHaveBeenCalledWith({ noSemanticValidation: false, noSyntaxValidation: false })
    unmount()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
