import type {
  ClosedQueryTabSnapshot,
  ConnectionProfile,
  DatastoreTestAssertion,
  DatastoreTestCaseDefinition,
  DatastoreTestStep,
  DatastoreTestSuiteDefinition,
  LibraryNode,
  QueryTabState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'

export type WorkspaceSearchSourceKind = 'connection' | 'library' | 'tab' | 'closed-tab'
export type WorkspaceSearchResultType =
  | 'connection'
  | 'folder'
  | 'query'
  | 'script'
  | 'test-suite'
  | 'library-item'
  | 'open-tab'
  | 'closed-tab'

export interface WorkspaceSearchDocumentLine {
  fieldLabel: string
  text: string
  lowerText: string
}

export interface WorkspaceSearchDocument {
  id: string
  sourceKind: WorkspaceSearchSourceKind
  resultType: WorkspaceSearchResultType
  sourceId: string
  title: string
  subtitle: string
  detail: string
  lines: WorkspaceSearchDocumentLine[]
}

export interface WorkspaceSearchIndex {
  documents: WorkspaceSearchDocument[]
  builtAt: number
}

export interface WorkspaceSearchOptions {
  matchCase: boolean
  wholeWord: boolean
  includedTypes?: readonly WorkspaceSearchResultType[]
  maxMatches?: number
}

export interface WorkspaceSearchMatch {
  id: string
  documentId: string
  sourceKind: WorkspaceSearchSourceKind
  resultType: WorkspaceSearchResultType
  sourceId: string
  title: string
  subtitle: string
  detail: string
  fieldLabel: string
  lineNumber: number
  lineText: string
  matchStart: number
  matchEnd: number
  fullLineText: string
  groupRank: number
}

export interface WorkspaceSearchGroup {
  document: WorkspaceSearchDocument
  matches: WorkspaceSearchMatch[]
}

export interface WorkspaceSearchResult {
  query: string
  groups: WorkspaceSearchGroup[]
  totalMatches: number
  displayedMatches: number
  truncated: boolean
}

const DEFAULT_MAX_MATCHES = 500
const SNIPPET_CONTEXT = 72
const SENSITIVE_KEY_PATTERN = /(auth|credential|password|secret|token|privatekey|clientkey)/i

export function buildWorkspaceSearchIndex(snapshot: WorkspaceSnapshot): WorkspaceSearchIndex {
  return {
    builtAt: Date.now(),
    documents: [
      ...snapshot.connections.map((connection) =>
        buildConnectionDocument(connection, snapshot.environments),
      ),
      ...snapshot.libraryNodes.map((node) => buildLibraryDocument(node)),
      ...snapshot.tabs
        .filter((tab) => tab.tabKind !== 'workspace-search')
        .map((tab) => buildTabDocument(tab, 'tab')),
      ...snapshot.closedTabs.map((tab) => buildTabDocument(tab, 'closed-tab')),
    ].filter((document) => document.lines.length > 0),
  }
}

export function searchWorkspaceIndex(
  index: WorkspaceSearchIndex,
  query: string,
  options: WorkspaceSearchOptions,
): WorkspaceSearchResult {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return {
      query,
      groups: [],
      totalMatches: 0,
      displayedMatches: 0,
      truncated: false,
    }
  }

  const needle = options.matchCase ? normalizedQuery : normalizedQuery.toLowerCase()
  const maxMatches = Math.max(1, options.maxMatches ?? DEFAULT_MAX_MATCHES)
  const includedTypes = options.includedTypes
    ? new Set<WorkspaceSearchResultType>(options.includedTypes)
    : undefined
  const groups: WorkspaceSearchGroup[] = []
  let totalMatches = 0
  let displayedMatches = 0

  for (const [groupRank, document] of index.documents.entries()) {
    if (includedTypes && !includedTypes.has(document.resultType)) {
      continue
    }

    const matches: WorkspaceSearchMatch[] = []

    for (const [lineIndex, line] of document.lines.entries()) {
      const haystack = options.matchCase ? line.text : line.lowerText
      let searchFrom = 0

      while (searchFrom <= haystack.length - needle.length) {
        const matchIndex = haystack.indexOf(needle, searchFrom)
        if (matchIndex < 0) {
          break
        }

        const matchEnd = matchIndex + needle.length
        searchFrom = matchEnd === matchIndex ? matchIndex + 1 : matchEnd

        if (options.wholeWord && !isWholeWordMatch(line.text, matchIndex, matchEnd)) {
          continue
        }

        totalMatches += 1

        if (displayedMatches >= maxMatches) {
          continue
        }

        const snippet = buildSnippet(line.text, matchIndex, matchEnd)
        matches.push({
          id: `${document.id}:${lineIndex}:${matchIndex}`,
          documentId: document.id,
          sourceKind: document.sourceKind,
          resultType: document.resultType,
          sourceId: document.sourceId,
          title: document.title,
          subtitle: document.subtitle,
          detail: document.detail,
          fieldLabel: line.fieldLabel,
          lineNumber: lineIndex + 1,
          lineText: snippet.text,
          matchStart: snippet.matchStart,
          matchEnd: snippet.matchEnd,
          fullLineText: line.text,
          groupRank,
        })
        displayedMatches += 1
      }
    }

    if (matches.length > 0) {
      groups.push({ document, matches })
    }
  }

  return {
    query,
    groups,
    totalMatches,
    displayedMatches,
    truncated: totalMatches > displayedMatches,
  }
}

function buildConnectionDocument(
  connection: ConnectionProfile,
  environments: WorkspaceSnapshot['environments'],
): WorkspaceSearchDocument {
  const environmentLabels = connection.environmentIds
    .map((id) => environments.find((environment) => environment.id === id)?.label)
    .filter((label): label is string => Boolean(label))

  return buildDocument({
    id: `connection:${connection.id}`,
    sourceKind: 'connection',
    resultType: 'connection',
    sourceId: connection.id,
    title: connection.name,
    subtitle: 'Connection',
    detail: [connection.engine, connection.family].filter(Boolean).join(' / '),
    fields: [
      ['Name', connection.name],
      ['Engine', connection.engine],
      ['Family', connection.family],
      ['Host', connection.host],
      ['Port', connection.port],
      ['Database', connection.database],
      ['Group', connection.group],
      ['Tags', connection.tags],
      ['Environment', environmentLabels],
      ['Access', connection.readOnly ? 'Read only' : undefined],
      ['Notes', connection.notes],
    ],
  })
}

function buildLibraryDocument(node: LibraryNode): WorkspaceSearchDocument {
  return buildDocument({
    id: `library:${node.id}`,
    sourceKind: 'library',
    resultType: libraryResultType(node.kind),
    sourceId: node.id,
    title: node.name,
    subtitle: libraryKindLabel(node.kind),
    detail: node.summary ?? '',
    fields: [
      ['Name', node.name],
      ['Kind', libraryKindLabel(node.kind)],
      ['Summary', node.summary],
      ['Tags', node.tags],
      ['Language', node.language],
      ['Query', node.queryText],
      ['Script', node.scriptText],
      ['Builder', safeStructuredText(node.builderState)],
      ['Test Suite', testSuiteText(node.testSuite)],
    ],
  })
}

function buildTabDocument(
  tab: QueryTabState | ClosedQueryTabSnapshot,
  sourceKind: 'tab' | 'closed-tab',
): WorkspaceSearchDocument {
  const savePath = tab.saveTarget?.kind === 'local-file' ? tab.saveTarget.path : undefined
  const historyText = tab.history.map((entry) => entry.queryText)
  const closedAt = 'closedAt' in tab ? tab.closedAt : undefined

  return buildDocument({
    id: `${sourceKind}:${tab.id}`,
    sourceKind,
    resultType: sourceKind === 'tab' ? 'open-tab' : 'closed-tab',
    sourceId: tab.id,
    title: tab.title,
    subtitle: sourceKind === 'tab' ? 'Open tab' : 'Recently closed tab',
    detail: [tab.editorLabel, tab.language, savePath].filter(Boolean).join(' / '),
    fields: [
      ['Title', tab.title],
      ['Editor', tab.editorLabel],
      ['Kind', tab.tabKind ?? 'query'],
      ['Language', tab.language],
      ['Local file', savePath],
      ['Scoped target', scopedTargetText(tab.scopedTarget)],
      ['Query', tab.queryText],
      ['Script', tab.scriptText],
      ['Builder', safeStructuredText(tab.builderState)],
      ['Test Suite', testSuiteText(tab.testSuite)],
      ['History', historyText],
      ['Closed', closedAt],
    ],
  })
}

function buildDocument(input: {
  id: string
  sourceKind: WorkspaceSearchSourceKind
  resultType: WorkspaceSearchResultType
  sourceId: string
  title: string
  subtitle: string
  detail: string
  fields: Array<[string, unknown]>
}): WorkspaceSearchDocument {
  const lines = input.fields.flatMap(([fieldLabel, value]) =>
    valueToSearchLines(fieldLabel, value),
  )

  return {
    id: input.id,
    sourceKind: input.sourceKind,
    resultType: input.resultType,
    sourceId: input.sourceId,
    title: input.title,
    subtitle: input.subtitle,
    detail: input.detail,
    lines,
  }
}

function valueToSearchLines(fieldLabel: string, value: unknown): WorkspaceSearchDocumentLine[] {
  const text = valueToSearchText(value)
  if (!text) {
    return []
  }

  return text
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => ({
      fieldLabel,
      text: line,
      lowerText: line.toLowerCase(),
    }))
}

function valueToSearchText(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (Array.isArray(value)) {
    return value.map(valueToSearchText).filter(Boolean).join('\n')
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return safeStructuredText(value)
}

function safeStructuredText(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  try {
    return JSON.stringify(value, redactingReplacer, 2)
  } catch {
    return ''
  }
}

function redactingReplacer(key: string, value: unknown) {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }

  return value
}

function testSuiteText(testSuite?: DatastoreTestSuiteDefinition): string {
  if (!testSuite) {
    return ''
  }

  const lines = [
    testSuite.name,
    testSuite.description,
    testSuite.engine,
    testSuite.family,
    ...testSuite.cases.flatMap(testCaseText),
  ]

  return lines.filter((line): line is string => Boolean(line)).join('\n')
}

function testCaseText(testCase: DatastoreTestCaseDefinition): string[] {
  return [
    testCase.name,
    scopedTargetText(testCase.scopedTarget),
    ...testCase.setup.flatMap(testStepText),
    ...testCase.execute.flatMap(testStepText),
    ...testCase.teardown.flatMap(testStepText),
    ...testCase.assertions.flatMap(assertionText),
  ].filter((line): line is string => Boolean(line))
}

function testStepText(step: DatastoreTestStep): string[] {
  return [
    step.label,
    step.phase,
    step.kind,
    step.language,
    step.queryText,
    safeStructuredText(step.builderState),
  ].filter((line): line is string => Boolean(line))
}

function assertionText(assertion: DatastoreTestAssertion): string[] {
  return [
    assertion.label,
    assertion.kind,
    assertion.comparison,
    assertion.path,
    assertion.field,
  ].filter((line): line is string => Boolean(line))
}

function scopedTargetText(target: QueryTabState['scopedTarget']): string {
  if (!target) {
    return ''
  }

  return [
    target.kind,
    target.label,
    target.scope,
    target.queryTemplate,
    ...(target.path ?? []),
  ].filter(Boolean).join('\n')
}

function libraryKindLabel(kind: LibraryNode['kind']) {
  return kind
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function libraryResultType(kind: LibraryNode['kind']): WorkspaceSearchResultType {
  switch (kind) {
    case 'folder':
      return 'folder'
    case 'connection':
      return 'connection'
    case 'query':
      return 'query'
    case 'script':
      return 'script'
    case 'test-suite':
      return 'test-suite'
    default:
      return 'library-item'
  }
}

function isWholeWordMatch(text: string, start: number, end: number) {
  return !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])
}

function isWordCharacter(character: string | undefined) {
  return Boolean(character && /[A-Za-z0-9_]/.test(character))
}

function buildSnippet(line: string, matchStart: number, matchEnd: number) {
  const rawStart = Math.max(0, matchStart - SNIPPET_CONTEXT)
  const rawEnd = Math.min(line.length, matchEnd + SNIPPET_CONTEXT)
  const start = rawStart > 0 ? Math.min(advanceToWordBoundary(line, rawStart), matchStart) : rawStart
  const end = rawEnd < line.length ? Math.max(retreatToWordBoundary(line, rawEnd), matchEnd) : rawEnd
  const prefix = start > 0 ? '...' : ''
  const suffix = end < line.length ? '...' : ''

  return {
    text: `${prefix}${line.slice(start, end)}${suffix}`,
    matchStart: prefix.length + matchStart - start,
    matchEnd: prefix.length + matchEnd - start,
  }
}

function advanceToWordBoundary(line: string, index: number) {
  let cursor = index
  while (cursor < line.length && isWordCharacter(line[cursor])) {
    cursor += 1
  }

  return Math.min(cursor + 1, line.length)
}

function retreatToWordBoundary(line: string, index: number) {
  let cursor = index
  while (cursor > 0 && isWordCharacter(line[cursor - 1])) {
    cursor -= 1
  }

  return Math.max(cursor - 1, 0)
}
