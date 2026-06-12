import { useCallback, useEffect, useState } from 'react'
import type {
  AppLogFileContent,
  AppLogFileSummary,
  DiagnosticsReport,
} from '@datapadplusplus/shared-types'
import { DeleteConfirmationPanel } from './results/DeleteConfirmationPanel'
import { RefreshIcon, SettingsIcon, TrashIcon } from './icons'
import {
  SettingsNotice,
  type SettingsNoticeMessage,
  SettingsPanel,
} from './SettingsWorkspace.parts'

export function SettingsLogsPanel({
  diagnostics,
  onClearLogFile,
  onDeleteLogFile,
  onListLogFiles,
  onReadLogFile,
}: {
  diagnostics?: DiagnosticsReport
  onClearLogFile(fileName: string): Promise<AppLogFileContent | undefined>
  onDeleteLogFile(fileName: string): Promise<AppLogFileSummary[] | undefined>
  onListLogFiles(): Promise<AppLogFileSummary[] | undefined>
  onReadLogFile(fileName: string): Promise<AppLogFileContent | undefined>
}) {
  const [files, setFiles] = useState<AppLogFileSummary[]>([])
  const [selected, setSelected] = useState<AppLogFileContent>()
  const [deleteFileName, setDeleteFileName] = useState<string>()
  const [notice, setNotice] = useState<SettingsNoticeMessage>()
  const logPath = selected?.file.path ?? diagnostics?.logPath
  const logDirectory = logPath ? parentPath(logPath) : 'Not available'

  const refreshLogs = useCallback(async (showNotice = false) => {
    const items = await onListLogFiles()
    if (items) {
      setFiles(items)
      if (!items.length) {
        setSelected(undefined)
      }
      if (showNotice && !items.length) {
        setNotice({ text: 'No log files found.', tone: 'info' })
      } else if (showNotice) {
        setNotice(undefined)
      }
    } else {
      setNotice({
        text: 'Logs could not be loaded. Restart the desktop debug session if this app was already running.',
        tone: 'error',
      })
    }
    return items
  }, [onListLogFiles])

  const openLog = useCallback(async (fileName: string) => {
    const content = await onReadLogFile(fileName)
    if (content) {
      setSelected(content)
      setNotice(undefined)
    } else {
      setNotice({ text: 'Log file could not be opened.', tone: 'error' })
    }
  }, [onReadLogFile])

  useEffect(() => {
    let mounted = true
    const timer = window.setTimeout(() => {
      void refreshLogs().then((items) => {
        const firstLog = items?.[0]
        if (!mounted || !firstLog) return
        void openLog(firstLog.fileName)
      })
    }, 0)
    return () => {
      mounted = false
      window.clearTimeout(timer)
    }
  }, [openLog, refreshLogs])

  const clearLog = async () => {
    if (!selected) return
    const content = await onClearLogFile(selected.file.fileName)
    if (content) {
      setSelected(content)
      setFiles((current) => current.map((file) => file.fileName === content.file.fileName ? content.file : file))
      setNotice({ text: 'Log file cleared.', tone: 'success' })
    } else {
      setNotice({ text: 'Log file could not be cleared.', tone: 'error' })
    }
  }

  const deleteLog = async (fileName: string) => {
    const items = await onDeleteLogFile(fileName)
    if (items) {
      setFiles(items)
      setSelected((current) => current?.file.fileName === fileName ? undefined : current)
      setDeleteFileName(undefined)
      setNotice({ text: 'Log file deleted.', tone: 'success' })
    } else {
      setNotice({ text: 'Log file could not be deleted.', tone: 'error' })
    }
  }

  return (
    <SettingsPanel title="Logs" icon={<SettingsIcon className="panel-inline-icon" />}>
      <div className="settings-log-path">
        <span>Log path</span>
        <code>{logDirectory}</code>
      </div>
      <div className="settings-log-layout">
        <div className="settings-log-list" role="list" aria-label="Log files">
          <div className="settings-action-row">
            <button type="button" className="drawer-button" onClick={() => void refreshLogs(true)}>
              <RefreshIcon className="drawer-inline-icon" />
              Refresh
            </button>
          </div>
          {files.length ? files.map((file) => (
            <button
              key={file.fileName}
              type="button"
              className={`settings-log-file${selected?.file.fileName === file.fileName ? ' is-active' : ''}`}
              onClick={() => void openLog(file.fileName)}
            >
              <strong>{file.fileName}</strong>
              <span>{formatBytes(file.sizeBytes)} - {formatDate(file.modifiedAt)}</span>
            </button>
          )) : (
            <div className="settings-empty">No log files found.</div>
          )}
        </div>
        <div className="settings-log-viewer">
          <div className="settings-action-row">
            <button type="button" className="drawer-button" disabled={!selected} onClick={() => void clearLog()}>
              Clear
            </button>
            <button type="button" className="drawer-button drawer-button--danger" disabled={!selected} onClick={() => selected ? setDeleteFileName(selected.file.fileName) : undefined}>
              <TrashIcon className="drawer-inline-icon" />
              Delete
            </button>
          </div>
          <textarea
            aria-label="Log file contents"
            className="settings-log-editor"
            readOnly
            value={selected?.content ?? ''}
            placeholder="Select a log file."
          />
        </div>
      </div>
      {deleteFileName ? (
        <DeleteConfirmationPanel
          title="Delete log file?"
          body="This removes the selected log file."
          confirmLabel="Delete"
          onCancel={() => setDeleteFileName(undefined)}
          onConfirm={() => void deleteLog(deleteFileName)}
        />
      ) : null}
      <SettingsNotice notice={notice} />
    </SettingsPanel>
  )
}

function parentPath(path: string) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : path
}

function formatDate(value: string | undefined) {
  if (!value) return 'Unknown'
  const numeric = Number(value)
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
