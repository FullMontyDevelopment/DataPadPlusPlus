import type { KeyboardEvent } from 'react'
import { useState } from 'react'
import { ConsoleIcon } from './icons'
import { DesktopCodeEditor } from './DesktopCodeEditor'
import type {
  DatastoreCompletionProvider,
  EditorCompletionContext,
} from './intellisense/types'
import { redisCommandDocForText } from './query-builder/redis-command-docs'

interface RedisConsoleEditorProps {
  value: string
  engineLabel: string
  history?: string[]
  pipelineMode?: boolean
  theme: 'light' | 'dark'
  completionContext?: EditorCompletionContext
  completionProviders?: DatastoreCompletionProvider[]
  onRequestCompletionRefresh?(): void
  onChange(value: string): void
  onPipelineModeChange?(enabled: boolean): void
  onRun(): void
}

export function RedisConsoleEditor({
  value,
  engineLabel,
  history = [],
  pipelineMode = false,
  theme,
  completionContext,
  completionProviders,
  onRequestCompletionRefresh,
  onChange,
  onPipelineModeChange,
  onRun,
}: RedisConsoleEditorProps) {
  const [historyIndex, setHistoryIndex] = useState<number | undefined>()
  const recentHistory = history.slice(0, 6)
  const pipelineCommandCount = redisConsoleLineCount(value)
  const commandDoc = redisCommandDocForText(value)
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onRun()
      setHistoryIndex(undefined)
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const nextCommand = commandFromHistory({
        currentIndex: historyIndex,
        direction: event.key === 'ArrowUp' ? 'previous' : 'next',
        history,
      })

      if (nextCommand !== undefined) {
        event.preventDefault()
        event.stopPropagation()
        setHistoryIndex(nextCommand.index)
        onChange(nextCommand.command)
      }
    }
  }

  return (
    <section
      className="redis-console-editor"
      aria-label={`${engineLabel} command console`}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <header className="redis-console-header">
        <ConsoleIcon className="toolbar-icon" />
        <span>{engineLabel} console</span>
        <div className="redis-console-header-actions">
          {onPipelineModeChange ? (
            <button
              type="button"
              className={pipelineMode ? 'is-active' : ''}
              aria-pressed={pipelineMode}
              title="Pipeline mode"
              onClick={() => onPipelineModeChange(!pipelineMode)}
            >
              Pipeline
            </button>
          ) : null}
          {pipelineMode ? (
            <small>{pipelineCommandCount} command(s)</small>
          ) : null}
          <small>Ctrl+Enter</small>
        </div>
      </header>
      <div className="redis-console-input-row">
        <span className="redis-console-prompt" aria-hidden="true">
          &gt;
        </span>
        <DesktopCodeEditor
          ariaLabel={`${engineLabel} command`}
          value={value}
          language="plaintext"
          theme={theme}
          completionContext={completionContext}
          completionProviders={completionProviders}
          onRequestCompletionRefresh={onRequestCompletionRefresh}
          onChange={onChange}
        />
      </div>
      {commandDoc ? (
        <div className="redis-console-doc" aria-label={`${commandDoc.command} command help`}>
          <strong>{commandDoc.command}</strong>
          <code>{commandDoc.syntax}</code>
          <span>{commandDoc.summary}</span>
          <small>{commandDoc.category}</small>
        </div>
      ) : null}
      <div className="redis-console-examples" aria-label={`${engineLabel} command examples`}>
        <button type="button" onClick={() => onChange('PING')}>
          PING
        </button>
        {pipelineMode ? (
          <button type="button" onClick={() => onChange('PING\nDBSIZE\nINFO stats')}>
            PIPELINE
          </button>
        ) : null}
        <button type="button" onClick={() => onChange('SCAN 0 MATCH * COUNT 100')}>
          SCAN
        </button>
        <button type="button" onClick={() => onChange('TYPE key:name')}>
          TYPE
        </button>
        <button type="button" onClick={() => onChange('GET key:name')}>
          GET
        </button>
        <button type="button" onClick={() => onChange('HGETALL hash:name')}>
          HGETALL
        </button>
        <button type="button" onClick={() => onChange('TTL key:name')}>
          TTL
        </button>
      </div>
      {recentHistory.length ? (
        <div className="redis-console-history" aria-label={`${engineLabel} command history`}>
          {recentHistory.map((command) => (
            <button type="button" key={command} onClick={() => onChange(command)}>
              {command}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function commandFromHistory({
  currentIndex,
  direction,
  history,
}: {
  currentIndex: number | undefined
  direction: 'previous' | 'next'
  history: string[]
}) {
  if (history.length === 0) {
    return undefined
  }

  const nextIndex =
    currentIndex === undefined
      ? 0
      : direction === 'previous'
        ? Math.min(currentIndex + 1, history.length - 1)
        : Math.max(currentIndex - 1, 0)

  return {
    command: history[nextIndex] ?? '',
    index: nextIndex,
  }
}

function redisConsoleLineCount(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')).length
}
