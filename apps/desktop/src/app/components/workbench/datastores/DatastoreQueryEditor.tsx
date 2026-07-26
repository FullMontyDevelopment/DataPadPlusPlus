import type { ComponentProps } from 'react'
import type {
  ConnectionProfile,
  DatastoreQueryEditorState,
  QueryBuilderState,
  QueryTabState,
  QueryViewMode,
} from '@datapadplusplus/shared-types'
import type { ComponentType } from 'react'
import { DesktopCodeEditor } from '../DesktopCodeEditor'
import { isRedisKeyBrowserState } from '../query-builder/redis-key-browser'
import { MongoScriptWorkspace } from './mongodb/MongoScriptWorkspace'
import { RedisConsoleEditor } from './common/keyvalue/RedisConsoleEditor'
import type { DatastoreQueryEditorWorkspaceProps } from './types'

type EditorProps = ComponentProps<typeof DesktopCodeEditor>

interface DatastoreQueryEditorProps {
  mode: QueryViewMode
  tab: QueryTabState
  redisConsoleVisible: boolean
  connection: ConnectionProfile
  builderState?: QueryBuilderState
  value?: string
  rawValue: string
  language: EditorProps['language']
  theme: EditorProps['theme']
  resetKey: EditorProps['resetKey']
  completionContext: EditorProps['completionContext']
  completionProviders: EditorProps['completionProviders']
  mongoDatabase?: string
  mongoCollection?: string
  mongoGuideVisible: boolean
  mongoGuideWidth: number
  readOnly?: boolean
  onRequestCompletionRefresh: EditorProps['onRequestCompletionRefresh']
  onSelectionChange: EditorProps['onSelectionChange']
  onRun(): void
  onRedisPipelineModeChange(enabled: boolean): void
  onRawChange(value: string): void
  onScriptChange(value: string): void
  onMongoGuideWidthChange(width: number): void
  onDropField: EditorProps['onDropField']
  editorState?: DatastoreQueryEditorState
  Editor?: ComponentType<DatastoreQueryEditorWorkspaceProps>
  onEditorStateChange?(state: DatastoreQueryEditorState): void
}

export function DatastoreQueryEditor({
  mode,
  tab,
  redisConsoleVisible,
  connection,
  builderState,
  value,
  rawValue,
  language,
  theme,
  resetKey,
  completionContext,
  completionProviders = [],
  mongoDatabase,
  mongoCollection,
  mongoGuideVisible,
  mongoGuideWidth,
  readOnly = false,
  onRequestCompletionRefresh,
  onSelectionChange,
  onRun,
  onRedisPipelineModeChange,
  onRawChange,
  onScriptChange,
  onMongoGuideWidthChange,
  onDropField,
  editorState,
  Editor,
  onEditorStateChange,
}: DatastoreQueryEditorProps) {
  if (mode === 'builder') {
    return null
  }

  if (mode === 'raw' && Editor && onEditorStateChange) {
    return (
      <Editor
        tab={tab}
        connection={connection}
        editorState={editorState}
        value={value ?? rawValue}
        theme={theme}
        resetKey={resetKey}
        completionContext={completionContext}
        completionProviders={completionProviders}
        readOnly={readOnly}
        onRequestCompletionRefresh={onRequestCompletionRefresh}
        onSelectionChange={onSelectionChange}
        onEditorStateChange={onEditorStateChange}
      />
    )
  }

  if (redisConsoleVisible) {
    return (
      <RedisConsoleEditor
        value={value ?? 'PING'}
        engineLabel={connection.engine === 'valkey' ? 'Valkey' : 'Redis'}
        history={isRedisKeyBrowserState(builderState) ? builderState.consoleHistory ?? [] : []}
        pipelineMode={
          isRedisKeyBrowserState(builderState) ? Boolean(builderState.pipelineMode) : false
        }
        theme={theme}
        resetKey={resetKey}
        completionContext={completionContext}
        completionProviders={completionProviders}
        readOnly={readOnly}
        onRequestCompletionRefresh={onRequestCompletionRefresh}
        onRun={onRun}
        onSelectionChange={onSelectionChange}
        onPipelineModeChange={onRedisPipelineModeChange}
        onChange={(nextValue) => onRawChange(nextValue)}
      />
    )
  }

  if (mode === 'script') {
    return (
      <MongoScriptWorkspace
        value={value ?? ''}
        theme={theme}
        resetKey={resetKey}
        database={mongoDatabase ?? connection.database}
        collection={mongoCollection}
        guideVisible={mongoGuideVisible}
        guideWidth={mongoGuideWidth}
        completionContext={completionContext}
        completionProviders={completionProviders}
        readOnly={readOnly}
        onRequestCompletionRefresh={onRequestCompletionRefresh}
        onSelectionChange={onSelectionChange}
        onGuideWidthChange={onMongoGuideWidthChange}
        onChange={(nextValue) => onScriptChange(nextValue ?? '')}
      />
    )
  }

  return (
    <DesktopCodeEditor
      value={value ?? rawValue}
      language={language}
      theme={theme}
      resetKey={resetKey}
      completionContext={completionContext}
      completionProviders={completionProviders}
      readOnly={readOnly}
      onRequestCompletionRefresh={onRequestCompletionRefresh}
      onSelectionChange={onSelectionChange}
      onChange={(nextValue) => onRawChange(nextValue ?? '')}
      onDropField={onDropField}
    />
  )
}
