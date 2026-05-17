import type { KeyboardEvent } from 'react'
import { ConsoleIcon } from './icons'
import { DesktopCodeEditor } from './DesktopCodeEditor'
import type {
  DatastoreCompletionProvider,
  EditorCompletionContext,
} from './intellisense/types'

interface RedisConsoleEditorProps {
  value: string
  engineLabel: string
  theme: 'light' | 'dark'
  completionContext?: EditorCompletionContext
  completionProviders?: DatastoreCompletionProvider[]
  onRequestCompletionRefresh?(): void
  onChange(value: string): void
  onRun(): void
}

export function RedisConsoleEditor({
  value,
  engineLabel,
  theme,
  completionContext,
  completionProviders,
  onRequestCompletionRefresh,
  onChange,
  onRun,
}: RedisConsoleEditorProps) {
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onRun()
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
        <small>Run one read command at a time. Ctrl+Enter runs the command.</small>
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
      <div className="redis-console-examples" aria-label={`${engineLabel} command examples`}>
        <button type="button" onClick={() => onChange('PING')}>
          PING
        </button>
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
    </section>
  )
}
