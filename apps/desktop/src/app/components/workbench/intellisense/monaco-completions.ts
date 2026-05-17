import type {
  CompletionItemKind,
  CompletionSuggestion,
  DatastoreCompletionProvider,
  EditorCompletionContext,
} from './types'

export interface MonacoPositionLike {
  lineNumber: number
  column: number
}

export interface MonacoWordLike {
  word: string
  startColumn: number
  endColumn: number
}

export interface MonacoModelLike {
  getValue(): string
  getOffsetAt(position: MonacoPositionLike): number
  getWordUntilPosition(position: MonacoPositionLike): MonacoWordLike
}

export interface MonacoDisposableLike {
  dispose(): void
}

export interface MonacoEditorLike {
  addCommand?(keybinding: number, handler: () => void): void
  trigger?(source: string, handlerId: string, payload: unknown): void
}

export interface MonacoApiLike {
  KeyMod?: {
    CtrlCmd?: number
  }
  KeyCode?: {
    Space?: number
  }
  languages: {
    CompletionItemKind?: Record<string, number>
    CompletionItemInsertTextRule?: Record<string, number>
    registerCompletionItemProvider(
      language: string,
      provider: {
        triggerCharacters?: string[]
        provideCompletionItems(
          model: MonacoModelLike,
          position: MonacoPositionLike,
        ): { suggestions: MonacoCompletionItemLike[] }
      },
    ): MonacoDisposableLike
  }
}

export interface MonacoCompletionItemLike {
  label: string
  kind: number
  insertText: string
  detail?: string
  documentation?: string
  sortText?: string
  range: {
    startLineNumber: number
    endLineNumber: number
    startColumn: number
    endColumn: number
  }
}

export function registerDatastoreCompletionProvider({
  monaco,
  editor,
  language,
  getContext,
  getProviders,
  onRequestCompletionRefresh,
}: {
  monaco: MonacoApiLike
  editor?: MonacoEditorLike
  language: string
  getContext(): EditorCompletionContext | undefined
  getProviders(): DatastoreCompletionProvider[]
  onRequestCompletionRefresh?(): void
}) {
  registerCtrlSpaceCommand(editor, monaco, onRequestCompletionRefresh)

  return monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', '"', '$', ':', ' ', '['],
    provideCompletionItems(model, position) {
      const context = getContext()

      if (!context) {
        return { suggestions: [] }
      }

      const queryText = model.getValue()
      const cursorOffset = model.getOffsetAt(position)
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const providerContext: EditorCompletionContext = {
        ...context,
        queryText,
        cursorOffset,
      }

      return {
        suggestions: getProviders().flatMap((provider) =>
          provider
            .buildItems(providerContext)
            .map((item) => toMonacoCompletion(item, range, monaco)),
        ),
      }
    },
  })
}

function registerCtrlSpaceCommand(
  editor: MonacoEditorLike | undefined,
  monaco: MonacoApiLike,
  onRequestCompletionRefresh: (() => void) | undefined,
) {
  const ctrlCmd = monaco.KeyMod?.CtrlCmd
  const space = monaco.KeyCode?.Space

  if (!editor?.addCommand || ctrlCmd === undefined || space === undefined) {
    return
  }

  editor.addCommand(ctrlCmd | space, () => {
    onRequestCompletionRefresh?.()
    editor.trigger?.('datapadplusplus-intellisense', 'editor.action.triggerSuggest', {})
  })
}

function toMonacoCompletion(
  item: CompletionSuggestion,
  range: MonacoCompletionItemLike['range'],
  monaco: MonacoApiLike,
): MonacoCompletionItemLike {
  return {
    label: item.label,
    kind: monacoKind(item.kind, monaco),
    insertText: item.insertText,
    detail: item.detail,
    documentation: item.documentation,
    sortText: item.sortText ?? sortPrefix(item.kind) + item.label,
    range,
  }
}

function monacoKind(kind: CompletionItemKind, monaco: MonacoApiLike) {
  const completionKinds = monaco.languages.CompletionItemKind

  if (!completionKinds) {
    return 1
  }

  switch (kind) {
    case 'schema':
      return completionKinds.Module ?? completionKinds.Folder ?? 1
    case 'table':
    case 'view':
    case 'collection':
    case 'index':
      return completionKinds.Class ?? completionKinds.Struct ?? 1
    case 'field':
      return completionKinds.Field ?? completionKinds.Property ?? 1
    case 'command':
    case 'keyword':
      return completionKinds.Keyword ?? 1
    case 'operator':
      return completionKinds.Operator ?? completionKinds.Keyword ?? 1
    case 'function':
      return completionKinds.Function ?? 1
    case 'snippet':
      return completionKinds.Snippet ?? 1
    case 'value':
      return completionKinds.Value ?? completionKinds.Constant ?? 1
    default:
      return completionKinds.Text ?? 1
  }
}

function sortPrefix(kind: CompletionItemKind) {
  switch (kind) {
    case 'keyword':
    case 'command':
      return '0-'
    case 'schema':
    case 'table':
    case 'view':
    case 'collection':
    case 'index':
      return '1-'
    case 'field':
      return '2-'
    case 'operator':
    case 'function':
      return '3-'
    case 'snippet':
      return '4-'
    default:
      return '5-'
  }
}
