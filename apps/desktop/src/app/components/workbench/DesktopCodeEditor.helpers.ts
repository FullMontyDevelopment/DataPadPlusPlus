import { variableDefinitionsForEnvironment } from '../../state/environment-variables'
import type { MonacoEditorLike } from './intellisense/monaco-completions'
import type { EditorCompletionContext } from './intellisense/types'

export function readMonacoSelection(editor: MonacoEditorLike) {
  const selection = editor.getSelection?.()
  const model = editor.getModel?.()
  return selection && model?.getValueInRange ? model.getValueInRange(selection) : ''
}

export function monacoThemeForWorkbenchTheme(theme: string) {
  return theme === 'light' || theme === 'solarized-light' ? 'vs' : 'vs-dark'
}

export function variableDecorations(
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
