import type { ExecutionRequest, ExecutionResponse } from '@datapadplusplus/shared-types'
import type { WorkbenchMessage } from '../../../state/app-state'
import { CloseIcon, WarningIcon } from '../icons'

interface MessagesViewProps {
  lastExecution?: ExecutionResponse
  lastExecutionRequest?: ExecutionRequest
  messages: string[]
  workbenchMessages: WorkbenchMessage[]
  onConfirmExecution(guardrailId: string, mode: ExecutionRequest['mode']): void
  onDismissWorkbenchMessage(id: string): void
  onClearWorkbenchMessages(): void
  onOpenSecuritySettings?(): void
}

export function MessagesView({
  lastExecution,
  lastExecutionRequest,
  messages,
  workbenchMessages,
  onConfirmExecution,
  onDismissWorkbenchMessage,
  onClearWorkbenchMessages,
  onOpenSecuritySettings,
}: MessagesViewProps) {
  const confirmationGuardrailId =
    lastExecution?.guardrail.status === 'confirm' ? lastExecution.guardrail.id : undefined
  const confirmationMentionsGlobalSafeMode = lastExecution?.guardrail.reasons.some(
    mentionsGlobalSafeMode,
  )
  const hasMessages = workbenchMessages.length > 0 || messages.length > 0

  return (
    <div className="panel-body-frame">
      <div className="panel-title-row">
        <div>
          <strong>Messages</strong>
          <p>Command errors, runtime notices, and query diagnostics.</p>
        </div>
        {workbenchMessages.length > 0 ? (
          <button
            type="button"
            className="drawer-button"
            aria-label="Clear all workbench messages"
            title="Clear all session-level workbench messages."
            onClick={onClearWorkbenchMessages}
          >
            Clear all
          </button>
        ) : null}
      </div>

      {!hasMessages && !confirmationGuardrailId ? (
        <div className="messages-empty">
          <WarningIcon className="empty-icon" />
          <p>No messages.</p>
        </div>
      ) : null}

      {workbenchMessages.length > 0 ? (
        <ul className="workbench-message-list" aria-label="Workbench Messages">
          {workbenchMessages.map((message) => (
            <li
              key={message.id}
              className={`workbench-message-row is-${message.severity}`}
              title={message.details ?? message.message}
            >
              <WarningIcon className="panel-inline-icon" />
              <div className="workbench-message-content">
                <strong>{message.message}</strong>
                <span>
                  {message.source} / {formatMessageTime(message.createdAt)}
                </span>
                {message.details ? <p>{message.details}</p> : null}
                {onOpenSecuritySettings &&
                (mentionsGlobalSafeMode(message.message) || mentionsGlobalSafeMode(message.details)) ? (
                  <button
                    type="button"
                    className="message-inline-action"
                    onClick={onOpenSecuritySettings}
                  >
                    Security settings
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className="bottom-panel-icon-button"
                aria-label={`Clear message ${message.message}`}
                title="Clear this message from the session log."
                onClick={() => onDismissWorkbenchMessage(message.id)}
              >
                <CloseIcon className="panel-inline-icon" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {messages.length > 0 ? (
        <ul className="messages-list">
          {messages.map((message, index) => (
            <li key={`${message}-${index}`}>{message}</li>
          ))}
        </ul>
      ) : null}

      {confirmationGuardrailId ? (
        <div className="panel-confirmation">
          <div>
            <strong>Confirmation required</strong>
            <p>{lastExecution?.guardrail.reasons.join(' ')}</p>
            {onOpenSecuritySettings && confirmationMentionsGlobalSafeMode ? (
              <button
                type="button"
                className="message-inline-action"
                onClick={onOpenSecuritySettings}
              >
                Security settings
              </button>
            ) : null}
            {lastExecution?.guardrail.requiredConfirmationText ? (
              <code>{lastExecution.guardrail.requiredConfirmationText}</code>
            ) : null}
          </div>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            onClick={() =>
              onConfirmExecution(confirmationGuardrailId, lastExecutionRequest?.mode ?? 'full')
            }
          >
            Run
          </button>
        </div>
      ) : null}
    </div>
  )
}

function mentionsGlobalSafeMode(value?: string) {
  return Boolean(value?.includes('Global safe mode requires confirmation'))
}

function formatMessageTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'now'
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
