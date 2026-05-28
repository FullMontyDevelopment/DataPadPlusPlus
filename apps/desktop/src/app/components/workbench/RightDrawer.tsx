import { useEffect, useRef, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import type {
  AppHealth,
  ConnectionProfile,
  ConnectionTestResult,
  DiagnosticsReport,
  EnvironmentProfile,
  ExecutionCapabilities,
  ExplorerInspectResponse,
  ExportBundle,
  LocalDatabaseCreateRequest,
  LocalDatabaseCreateResult,
  LocalDatabasePickRequest,
  LocalDatabasePickResult,
  RightDrawerView,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { ConnectionsIcon } from './icons'
import { ConnectionBlade } from './RightDrawer.connection-blade'
import { DiagnosticsBlade } from './RightDrawer.diagnostics-blade'
import { InspectionBlade } from './RightDrawer.inspection-blade'
import { DrawerHeader } from './RightDrawer.primitives'

interface RightDrawerProps {
  view: RightDrawerView
  width: number
  health: AppHealth
  theme: WorkspaceSnapshot['preferences']['theme']
  activeConnection?: ConnectionProfile
  environments: EnvironmentProfile[]
  connectionTest?: ConnectionTestResult
  diagnostics?: DiagnosticsReport
  explorerInspection?: ExplorerInspectResponse
  exportBundle?: ExportBundle
  capabilities: ExecutionCapabilities
  exportPassphrase: string
  importPayload: string
  onExportPassphraseChange(value: string): void
  onImportPayloadChange(value: string): void
  onClose(): void
  onSaveConnection(profile: ConnectionProfile, secret?: string): Promise<boolean>
  onTestConnection(profile: ConnectionProfile, environmentId: string, secret?: string): void
  onRefreshDiagnostics(): void
  onExportWorkspace(includeSecrets: boolean): void
  onImportWorkspace(encryptedPayload: string): void
  onApplyTemplate(queryTemplate?: string): void
  onToggleTheme(): void
  onPickLocalDatabaseFile(request: LocalDatabasePickRequest): Promise<LocalDatabasePickResult>
  onCreateLocalDatabase(
    request: LocalDatabaseCreateRequest,
  ): Promise<LocalDatabaseCreateResult | undefined>
  onResize(width: number): void
}

export function RightDrawer({
  view,
  width,
  health,
  theme,
  activeConnection,
  environments,
  connectionTest,
  diagnostics,
  explorerInspection,
  exportBundle,
  capabilities,
  exportPassphrase,
  importPayload,
  onExportPassphraseChange,
  onImportPayloadChange,
  onClose,
  onSaveConnection,
  onTestConnection,
  onRefreshDiagnostics,
  onExportWorkspace,
  onImportWorkspace,
  onApplyTemplate,
  onToggleTheme,
  onPickLocalDatabaseFile,
  onCreateLocalDatabase,
  onResize,
}: RightDrawerProps) {
  const [isResizing, setIsResizing] = useState(false)
  const lastPointerX = useRef(0)
  const resizeFrame = useRef<number | undefined>(undefined)
  const draftWidth = useRef(width)
  const workbenchRef = useRef<HTMLElement | null>(null)
  const isResizingRef = useRef(false)

  const applyDraftWidth = (nextWidth: number) => {
    const clampedWidth = clampDrawerWidth(nextWidth)
    draftWidth.current = clampedWidth
    workbenchRef.current?.style.setProperty('--drawer-width', `${clampedWidth}px`)
  }

  const scheduleDraftWidth = (nextWidth: number) => {
    draftWidth.current = clampDrawerWidth(nextWidth)
    if (resizeFrame.current !== undefined) {
      return
    }

    resizeFrame.current = window.requestAnimationFrame(() => {
      resizeFrame.current = undefined
      applyDraftWidth(draftWidth.current)
    })
  }

  const stopResizing = () => {
    if (!isResizingRef.current) {
      return
    }

    if (resizeFrame.current !== undefined) {
      window.cancelAnimationFrame(resizeFrame.current)
      resizeFrame.current = undefined
      applyDraftWidth(draftWidth.current)
    }

    document.body.classList.remove('is-right-drawer-resizing')
    isResizingRef.current = false
    setIsResizing(false)
    onResize(draftWidth.current)
  }

  useEffect(() => {
    return () => {
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current)
      }
      document.body.classList.remove('is-right-drawer-resizing')
    }
  }, [])

  const drawerLabel = view === 'diagnostics' ? 'settings drawer' : `${view} drawer`

  return (
    <aside className="workbench-drawer" aria-label={drawerLabel}>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize right drawer"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={560}
        aria-valuenow={width}
        className={`pane-resize-handle pane-resize-handle--drawer${isResizing ? ' is-active' : ''}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          workbenchRef.current = event.currentTarget.closest('.ads-workbench')
          lastPointerX.current = event.clientX
          draftWidth.current = clampDrawerWidth(width)
          isResizingRef.current = true
          document.body.classList.add('is-right-drawer-resizing')
          setIsResizing(true)
        }}
        onPointerMove={(event) => {
          if (!isResizingRef.current) {
            return
          }

          const delta = lastPointerX.current - event.clientX
          lastPointerX.current = event.clientX
          scheduleDraftWidth(draftWidth.current + delta)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          stopResizing()
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          stopResizing()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            onResize(width + 16)
          }

          if (event.key === 'ArrowRight') {
            event.preventDefault()
            onResize(width - 16)
          }
        }}
      />

      {view === 'connection' ? (
        activeConnection ? (
          <ConnectionBlade
            activeConnection={activeConnection}
            environments={environments}
            connectionTest={connectionTest}
            onClose={onClose}
            onSaveConnection={onSaveConnection}
            onTestConnection={onTestConnection}
            onPickLocalDatabaseFile={onPickLocalDatabaseFile}
            onCreateLocalDatabase={onCreateLocalDatabase}
          />
        ) : (
          <DrawerPlaceholder
            copy="Create a connection first to edit profile details."
            icon={ConnectionsIcon}
            title="No Connection"
            onClose={onClose}
          />
        )
      ) : null}

      {view === 'inspection' ? (
        <InspectionBlade
          capabilities={capabilities}
          inspection={explorerInspection}
          onApplyTemplate={onApplyTemplate}
          onClose={onClose}
        />
      ) : null}

      {view === 'diagnostics' ? (
        <DiagnosticsBlade
          diagnostics={diagnostics}
          exportBundle={exportBundle}
          exportPassphrase={exportPassphrase}
          health={health}
          importPayload={importPayload}
          theme={theme}
          onClose={onClose}
          onExportPassphraseChange={onExportPassphraseChange}
          onExportWorkspace={onExportWorkspace}
          onImportPayloadChange={onImportPayloadChange}
          onImportWorkspace={onImportWorkspace}
          onRefreshDiagnostics={onRefreshDiagnostics}
          onToggleTheme={onToggleTheme}
        />
      ) : null}
    </aside>
  )
}

function clampDrawerWidth(value: number) {
  return Math.min(560, Math.max(320, Math.round(value)))
}

function DrawerPlaceholder({
  copy,
  icon,
  title,
  onClose,
}: {
  copy: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  onClose(): void
}) {
  return (
    <>
      <DrawerHeader title={title} subtitle="Workspace" icon={icon} onClose={onClose} />
      <div className="drawer-scroll">
        <div className="drawer-section">
          <p className="drawer-copy">{copy}</p>
        </div>
      </div>
    </>
  )
}
