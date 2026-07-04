import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  FirstInstallGuideStepId,
  LibraryNode,
  QueryTabState,
  UiState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  getGuidePopoverStyle,
  type GuidePopoverPlacement,
  type GuidePopoverSize,
  type SpotlightState,
} from './FirstInstallGuide.placement'
import { CloseIcon } from './icons'

type GuideStepId = FirstInstallGuideStepId

interface GuideStep {
  id: GuideStepId
  title: string
  body: string
  anchor: string
  placement: GuidePopoverPlacement
  actionLabel?: string
}

interface FirstInstallGuideProps {
  snapshot: WorkspaceSnapshot
  connectionDraftOpen: boolean
  startRequestRevision: number
  onStart(stepId: GuideStepId): void
  onSkip(): void
  onComplete(): void
  onStepChange(stepId: GuideStepId): void
  onOpenLibrary(): void
  onRequestCreateFolder(): void
  onCloseCreateFolder(): void
  onOpenConnection(parentId?: string): void
  onOpenConnectionPanel(connectionId: string): void
  onCloseConnectionPanel(): void
  onOpenExplorer(connectionId: string): void
  onOpenQuery(connectionId: string): void
  onOpenSettings(): void
  onShowResults(): void
  onSelectTab(tabId: string): void
  onCloseTab(tabId: string): void
  onRestoreUiState(patch: Partial<UiState>): void
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to DataPad++',
    body: 'This quick tour uses the real workspace and starts with the Library, where connections, folders, queries, scripts, tests, and notes live.',
    anchor: 'library-sidebar',
    placement: 'right',
  },
  {
    id: 'folder',
    title: 'Organize the Library',
    body: 'Create a folder first. Folders keep connections, queries, scripts, notes, and tests grouped together.',
    anchor: 'library-add-folder',
    placement: 'right',
    actionLabel: 'Create Folder',
  },
  {
    id: 'connection',
    title: 'Create a connection',
    body: 'Open a new unsaved connection draft. You can choose a datastore, connection mode, environment, and safety flags before saving.',
    anchor: 'library-add-connection',
    placement: 'right',
    actionLabel: 'New Connection',
  },
  {
    id: 'save',
    title: 'Test and save',
    body: 'The drawer lets you test credentials with the selected environment, then save only when the profile is ready.',
    anchor: 'connection-drawer',
    placement: 'left',
    actionLabel: 'Open Connection Panel',
  },
  {
    id: 'explorer',
    title: 'Browse metadata',
    body: 'Explorer gives you a structure view of the selected datastore before you write or run a query.',
    anchor: 'explorer-metadata',
    placement: 'top',
    actionLabel: 'Open Explorer',
  },
  {
    id: 'query',
    title: 'Query and review results',
    body: 'Query tabs combine the editor, run controls, and results panel so you can inspect data and history in one place.',
    anchor: 'editor-toolbar',
    placement: 'bottom',
    actionLabel: 'Open Query Tab',
  },
  {
    id: 'settings',
    title: 'Check safety settings',
    body: 'Settings contain safe mode, backups, diagnostics, shortcuts, and opt-in plugins for the workspace.',
    anchor: 'settings-safety',
    placement: 'right',
    actionLabel: 'Open Settings',
  },
]

const GUIDE_STEP_IDS = GUIDE_STEPS.map((step) => step.id)

export function FirstInstallGuide({
  snapshot,
  connectionDraftOpen,
  startRequestRevision,
  onStart,
  onSkip,
  onComplete,
  onStepChange,
  onOpenLibrary,
  onRequestCreateFolder,
  onCloseCreateFolder,
  onOpenConnection,
  onOpenConnectionPanel,
  onCloseConnectionPanel,
  onOpenExplorer,
  onOpenQuery,
  onOpenSettings,
  onShowResults,
  onSelectTab,
  onCloseTab,
  onRestoreUiState,
}: FirstInstallGuideProps) {
  const guidePreferences = snapshot.preferences.firstInstallGuide
  const guideStatus = guidePreferences?.status ?? 'unseen'
  const state = useMemo(
    () => guideState(snapshot, connectionDraftOpen),
    [connectionDraftOpen, snapshot],
  )
  const [currentStepId, setCurrentStepId] = useState<GuideStepId>(() =>
    clampStepIdForState(sanitizeGuideStepId(guidePreferences?.currentStepId) ?? 'welcome', state),
  )
  const [spotlight, setSpotlight] = useState<SpotlightState>()
  const [popoverSize, setPopoverSize] = useState<GuidePopoverSize>({
    width: 360,
    height: 260,
  })
  const [lastStartRequestRevision, setLastStartRequestRevision] =
    useState(startRequestRevision)
  const popoverRef = useRef<HTMLElement | null>(null)
  const saveStepAutoOpenPending = useRef(false)
  const autoStepTokenRef = useRef<Record<string, string>>({})
  const ownedSurfacesRef = useRef<GuideOwnedSurfaces>({})
  const pendingActionRef = useRef<PendingGuideAction | undefined>(undefined)
  const persistedStepRef = useRef<GuideStepId | undefined>(undefined)

  const shouldPrompt = guideStatus === 'unseen' && workspaceIsEmpty(snapshot)
  const isRunning = guideStatus === 'started'
  const effectiveStepId = clampStepIdForState(currentStepId, state)
  const currentStep = stepById(effectiveStepId)
  const currentStepIndex = stepIndex(effectiveStepId)

  const runTrackedStepAction = useCallback(
    (stepId: GuideStepId) => {
      if (stepId === 'folder') {
        ownedSurfacesRef.current.folderDialogOpen = true
      }

      if ((stepId === 'connection' || stepId === 'save') && !state.connectionPanelOpen) {
        ownedSurfacesRef.current.connectionPanelOpen = true
      }

      if (stepId === 'explorer' || stepId === 'query' || stepId === 'settings') {
        pendingActionRef.current = createPendingGuideAction(stepId, snapshot)
      }

      runStepAction(stepId, state, {
        onOpenLibrary,
        onRequestCreateFolder,
        onOpenConnection,
        onOpenConnectionPanel,
        onOpenExplorer,
        onOpenQuery,
        onOpenSettings,
        onShowResults,
      })
    },
    [
      onOpenConnection,
      onOpenConnectionPanel,
      onOpenExplorer,
      onOpenLibrary,
      onOpenQuery,
      onOpenSettings,
      onRequestCreateFolder,
      onShowResults,
      snapshot,
      state,
    ],
  )

  const focusExistingQueryTab = useCallback(
    (tabId: string) => {
      if (!ownedSurfacesRef.current.query) {
        ownedSurfacesRef.current.query = createOwnedTabSurface('query', tabId, snapshot, false)
      }

      if (state.activeTabId !== tabId) {
        onSelectTab(tabId)
      }

      onShowResults()
    },
    [onSelectTab, onShowResults, snapshot, state.activeTabId],
  )

  const undoTabSurface = useCallback(
    (key: GuideTabSurfaceKey) => {
      const surface = ownedSurfacesRef.current[key]
      if (!surface) {
        return
      }

      const tab = snapshot.tabs.find((item) => item.id === surface.tabId)
      if (surface.createdByGuide && tab && canCloseGuideOwnedTab(tab, surface)) {
        onCloseTab(tab.id)
      } else if (
        surface.previousActiveTabId &&
        snapshot.tabs.some((item) => item.id === surface.previousActiveTabId)
      ) {
        onSelectTab(surface.previousActiveTabId)
      }

      if (key === 'query') {
        onRestoreUiState({
          activeBottomPanelTab: surface.previousBottomPanelTab,
          bottomPanelVisible: surface.previousBottomPanelVisible,
        })
      }

      delete ownedSurfacesRef.current[key]
    },
    [onCloseTab, onRestoreUiState, onSelectTab, snapshot.tabs],
  )

  const undoStep = useCallback(
    (stepId: GuideStepId) => {
      switch (stepId) {
        case 'folder':
          if (ownedSurfacesRef.current.folderDialogOpen) {
            onCloseCreateFolder()
            ownedSurfacesRef.current.folderDialogOpen = false
          }
          break
        case 'connection':
        case 'save':
          if (ownedSurfacesRef.current.connectionPanelOpen) {
            onCloseConnectionPanel()
            ownedSurfacesRef.current.connectionPanelOpen = false
          }
          break
        case 'explorer':
          undoTabSurface('explorer')
          break
        case 'query':
          undoTabSurface('query')
          break
        case 'settings':
          undoTabSurface('settings')
          break
        default:
          break
      }
    },
    [onCloseConnectionPanel, onCloseCreateFolder, undoTabSurface],
  )

  useEffect(() => {
    if (!isRunning) {
      persistedStepRef.current = undefined
      return
    }

    if (guidePreferences?.currentStepId === effectiveStepId) {
      persistedStepRef.current = effectiveStepId
      return
    }

    if (persistedStepRef.current === effectiveStepId) {
      return
    }

    persistedStepRef.current = effectiveStepId
    onStepChange(effectiveStepId)
  }, [effectiveStepId, guidePreferences?.currentStepId, isRunning, onStepChange])

  useEffect(() => {
    if (startRequestRevision === lastStartRequestRevision) {
      return
    }

    const timeout = window.setTimeout(() => {
      setLastStartRequestRevision(startRequestRevision)
      setCurrentStepId('welcome')
      ownedSurfacesRef.current = {}
      pendingActionRef.current = undefined
      autoStepTokenRef.current = {}
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [lastStartRequestRevision, startRequestRevision])

  useEffect(() => {
    if (!isRunning) {
      return
    }

    if (effectiveStepId === 'welcome') {
      const token = `welcome:${state.activeSidebarPane}:${state.sidebarCollapsed}`
      if (autoStepTokenRef.current.welcome !== token) {
        autoStepTokenRef.current.welcome = token
        onOpenLibrary()
      }
      return
    }

    if (effectiveStepId === 'save') {
      const saveStepPanelOpen = state.firstConnectionId
        ? state.connectionPanelOpen
        : state.connectionDrawerOpen

      if (saveStepPanelOpen) {
        saveStepAutoOpenPending.current = false
        return
      }

      if (!saveStepAutoOpenPending.current) {
        saveStepAutoOpenPending.current = true
        runTrackedStepAction('save')
      }
      return
    }

    saveStepAutoOpenPending.current = false

    if (effectiveStepId === 'explorer' && state.firstConnectionId) {
      const targetFocused = state.explorerTabId && state.activeTabId === state.explorerTabId
      const token = `explorer:${state.firstConnectionId}:${state.explorerTabId ?? 'missing'}:${state.activeTabId}`
      if (!targetFocused && autoStepTokenRef.current.explorer !== token) {
        autoStepTokenRef.current.explorer = token
        runTrackedStepAction('explorer')
      }
      return
    }

    if (effectiveStepId === 'query' && state.firstConnectionId) {
      const token = `query:${state.firstConnectionId}:${state.queryTabId ?? 'missing'}:${state.activeTabId}:${state.bottomPanelVisible}:${state.activeBottomPanelTab}`
      if (autoStepTokenRef.current.query === token) {
        return
      }

      autoStepTokenRef.current.query = token
      if (state.queryTabId) {
        focusExistingQueryTab(state.queryTabId)
      } else {
        runTrackedStepAction('query')
      }
      return
    }

    if (effectiveStepId === 'settings') {
      const targetFocused = state.settingsTabId && state.activeTabId === state.settingsTabId
      const token = `settings:${state.settingsTabId ?? 'missing'}:${state.activeTabId}`
      if (!targetFocused && autoStepTokenRef.current.settings !== token) {
        autoStepTokenRef.current.settings = token
        runTrackedStepAction('settings')
      }
    }
  }, [
    effectiveStepId,
    focusExistingQueryTab,
    isRunning,
    onOpenLibrary,
    runTrackedStepAction,
    state.activeBottomPanelTab,
    state.activeSidebarPane,
    state.activeTabId,
    state.bottomPanelVisible,
    state.connectionDrawerOpen,
    state.connectionPanelOpen,
    state.explorerTabId,
    state.firstConnectionId,
    state.queryTabId,
    state.settingsTabId,
    state.sidebarCollapsed,
  ])

  useEffect(() => {
    const pending = pendingActionRef.current
    if (!pending) {
      return
    }

    const tab = pendingTabForStep(pending, snapshot, state.firstConnectionId)
    if (!tab) {
      return
    }

    const surface = createOwnedTabSurface(
      pending.stepId as GuideTabSurfaceKey,
      tab.id,
      snapshot,
      !pending.beforeTabIds.has(tab.id),
      pending,
    )

    if (pending.stepId === 'explorer') {
      ownedSurfacesRef.current.explorer = surface
    }
    if (pending.stepId === 'query') {
      ownedSurfacesRef.current.query = surface
    }
    if (pending.stepId === 'settings') {
      ownedSurfacesRef.current.settings = surface
    }

    pendingActionRef.current = undefined
  }, [snapshot, state.firstConnectionId])

  useEffect(() => {
    const element = popoverRef.current
    if (!element || !isRunning || !currentStep) {
      return
    }

    const measure = () => {
      const rect = element.getBoundingClientRect()
      setPopoverSize((current) => {
        const nextWidth = Math.ceil(rect.width || 360)
        const nextHeight = Math.ceil(rect.height || 260)
        return current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      })
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [currentStep, isRunning])

  useEffect(() => {
    if (!isRunning || !currentStep) {
      const timeout = window.setTimeout(() => {
        setSpotlight(undefined)
      }, 0)

      return () => window.clearTimeout(timeout)
    }

    let frame = 0
    const update = () => {
      frame = 0
      setSpotlight(resolveSpotlight(currentStep.anchor))
    }
    const schedule = () => {
      if (frame) {
        return
      }
      frame = window.requestAnimationFrame(update)
    }

    schedule()
    const retry = window.setTimeout(schedule, 120)
    const observer =
      typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(schedule)
    observer?.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      window.clearTimeout(retry)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [currentStep, isRunning])

  if (shouldPrompt) {
    return (
      <div className="workbench-modal-overlay first-install-guide-prompt" role="presentation">
        <section
          className="workbench-dialog first-install-guide-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-install-guide-prompt-title"
        >
          <p className="sidebar-eyebrow">First Install Guide</p>
          <h2 id="first-install-guide-prompt-title">Take a quick tour?</h2>
          <p>
            Walk through folders, connections, Explorer, queries, results, and
            safety settings using the actual workspace controls.
          </p>
          <div className="workbench-dialog-actions">
            <button type="button" className="drawer-button" onClick={onSkip}>
              Skip
            </button>
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              onClick={() => {
                setCurrentStepId('welcome')
                ownedSurfacesRef.current = {}
                pendingActionRef.current = undefined
                autoStepTokenRef.current = {}
                onStart('welcome')
              }}
            >
              Start Tutorial
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (!isRunning || !currentStep) {
    return null
  }

  const stepNumber = currentStepIndex + 1
  const isFinalStep = currentStepIndex >= GUIDE_STEPS.length - 1
  const stepComplete = stepIsComplete(currentStep.id, state)
  const canAdvance = stepCanAdvance(currentStep.id, state)
  const actionDisabled = stepActionDisabled(currentStep.id, state)
  const helperText = stepComplete
    ? 'Done. You can keep moving.'
    : stepBlockingReason(currentStep.id, state)
  const actionIsPrimary = Boolean(currentStep.actionLabel && !canAdvance)

  return (
    <div className="first-install-guide-layer" aria-live="polite">
      {spotlight ? (
        <div
          className="first-install-guide-spotlight"
          style={spotlightStyle(spotlight)}
          aria-hidden="true"
        />
      ) : null}
      <section
        ref={popoverRef}
        className={`first-install-guide-popover${spotlight ? '' : ' is-unanchored'}`}
        style={popoverStyle(spotlight, currentStep.placement, popoverSize)}
        role="dialog"
        aria-modal="false"
        aria-labelledby="first-install-guide-title"
      >
        <button
          type="button"
          className="first-install-guide-close"
          aria-label="Close tutorial"
          title="Close tutorial"
          onClick={onSkip}
        >
          <CloseIcon className="panel-inline-icon" />
        </button>
        <p className="first-install-guide-progress">
          Step {stepNumber} of {GUIDE_STEPS.length}
        </p>
        <h2 id="first-install-guide-title">{currentStep.title}</h2>
        <p>{currentStep.body}</p>
        <p
          className={
            stepComplete
              ? 'first-install-guide-done'
              : 'first-install-guide-hint'
          }
        >
          {helperText}
        </p>
        <div className="first-install-guide-actions">
          <button
            type="button"
            className="drawer-button"
            disabled={currentStepIndex === 0}
            onClick={() => {
              undoStep(currentStep.id)
              setCurrentStepId(previousStepId(effectiveStepId))
            }}
          >
            Back
          </button>
          <button type="button" className="drawer-button" onClick={onSkip}>
            Skip
          </button>
          {currentStep.actionLabel ? (
            <button
              type="button"
              className={`drawer-button${actionIsPrimary ? ' drawer-button--primary' : ''}`}
              disabled={actionDisabled}
              onClick={() => runTrackedStepAction(currentStep.id)}
            >
              {currentStep.actionLabel}
            </button>
          ) : null}
          {isFinalStep ? (
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              disabled={!stepComplete}
              onClick={onComplete}
            >
              Finish
            </button>
          ) : (
            <button
              type="button"
              className={`drawer-button${actionIsPrimary ? '' : ' drawer-button--primary'}`}
              disabled={!canAdvance}
              onClick={() => setCurrentStepId(nextStepId(effectiveStepId))}
            >
              Next
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

interface GuideRuntimeState {
  folders: LibraryNode[]
  firstConnectionId?: string
  explorerTabId?: string
  queryTabId?: string
  settingsTabId?: string
  hasExplorerTab: boolean
  hasQueryTab: boolean
  hasSettingsTab: boolean
  connectionPanelOpen: boolean
  connectionDrawerOpen: boolean
  activeTabId: string
  activeSidebarPane: string
  sidebarCollapsed: boolean
  activeBottomPanelTab: UiState['activeBottomPanelTab']
  bottomPanelVisible: boolean
}

interface GuideActions {
  onOpenLibrary(): void
  onRequestCreateFolder(): void
  onOpenConnection(parentId?: string): void
  onOpenConnectionPanel(connectionId: string): void
  onOpenExplorer(connectionId: string): void
  onOpenQuery(connectionId: string): void
  onOpenSettings(): void
  onShowResults(): void
}

interface PendingGuideAction {
  stepId: Extract<GuideStepId, 'explorer' | 'query' | 'settings'>
  beforeTabIds: Set<string>
  previousActiveTabId?: string
  previousBottomPanelVisible: boolean
  previousBottomPanelTab: UiState['activeBottomPanelTab']
}

type GuideTabSurfaceKey = 'explorer' | 'query' | 'settings'

interface OwnedTabSurface {
  tabId: string
  createdByGuide: boolean
  previousActiveTabId?: string
  previousBottomPanelVisible: boolean
  previousBottomPanelTab: UiState['activeBottomPanelTab']
  initialQueryText?: string
  initialScriptText?: string
  initialHistoryLength: number
}

interface GuideOwnedSurfaces {
  folderDialogOpen?: boolean
  connectionPanelOpen?: boolean
  explorer?: OwnedTabSurface
  query?: OwnedTabSurface
  settings?: OwnedTabSurface
}

function guideState(
  snapshot: WorkspaceSnapshot,
  connectionDraftOpen: boolean,
): GuideRuntimeState {
  const explorerTab = snapshot.tabs.find((tab) => tab.tabKind === 'explorer')
  const queryTab = snapshot.tabs.find(isQueryTab)
  const settingsTab = snapshot.tabs.find((tab) => tab.tabKind === 'settings')

  return {
    folders: snapshot.libraryNodes.filter((node) => node.kind === 'folder'),
    firstConnectionId: snapshot.connections[0]?.id,
    explorerTabId: explorerTab?.id,
    queryTabId: queryTab?.id,
    settingsTabId: settingsTab?.id,
    hasExplorerTab: Boolean(explorerTab),
    hasQueryTab: Boolean(queryTab),
    hasSettingsTab: Boolean(settingsTab),
    connectionPanelOpen: snapshot.ui.rightDrawer === 'connection',
    connectionDrawerOpen: snapshot.ui.rightDrawer === 'connection' && connectionDraftOpen,
    activeTabId: snapshot.ui.activeTabId,
    activeSidebarPane: snapshot.ui.activeSidebarPane,
    sidebarCollapsed: snapshot.ui.sidebarCollapsed,
    activeBottomPanelTab: snapshot.ui.activeBottomPanelTab,
    bottomPanelVisible: snapshot.ui.bottomPanelVisible,
  }
}

function workspaceIsEmpty(snapshot: WorkspaceSnapshot) {
  return (
    snapshot.connections.length === 0 &&
    snapshot.tabs.length === 0 &&
    snapshot.libraryNodes.length === 0
  )
}

function clampStepIdForState(stepId: GuideStepId, state: GuideRuntimeState): GuideStepId {
  const index = stepIndex(stepId)

  if (index > stepIndex('welcome') && state.folders.length === 0) {
    return 'folder'
  }

  if (index > stepIndex('save') && !state.firstConnectionId) {
    return 'save'
  }

  if (index > stepIndex('explorer') && !state.hasExplorerTab) {
    return 'explorer'
  }

  if (index > stepIndex('query') && !state.hasQueryTab) {
    return 'query'
  }

  return stepId
}

function stepIsComplete(stepId: GuideStepId, state: GuideRuntimeState) {
  switch (stepId) {
    case 'welcome':
      return true
    case 'folder':
      return state.folders.length > 0
    case 'connection':
      return state.connectionDrawerOpen || Boolean(state.firstConnectionId)
    case 'save':
      return Boolean(state.firstConnectionId)
    case 'explorer':
      return state.hasExplorerTab
    case 'query':
      return state.hasQueryTab
    case 'settings':
      return state.hasSettingsTab
    default:
      return false
  }
}

function stepCanAdvance(stepId: GuideStepId, state: GuideRuntimeState) {
  if (stepId === 'welcome') {
    return true
  }

  return stepIsComplete(stepId, state)
}

function stepActionDisabled(stepId: GuideStepId, state: GuideRuntimeState) {
  return (stepId === 'explorer' || stepId === 'query') && !state.firstConnectionId
}

function stepBlockingReason(stepId: GuideStepId, state: GuideRuntimeState) {
  switch (stepId) {
    case 'folder':
      return 'Create a folder to keep the tour moving.'
    case 'connection':
      return 'Open the connection drawer to continue.'
    case 'save':
      return state.connectionPanelOpen || state.connectionDrawerOpen
        ? 'Save the connection when it is ready. Testing is optional.'
        : 'The connection panel will open here so you can test and save.'
    case 'explorer':
      return state.firstConnectionId
        ? 'Explorer is opening for the saved connection.'
        : 'Save a connection before opening Explorer.'
    case 'query':
      return state.firstConnectionId
        ? 'A query tab is opening for the saved connection.'
        : 'Save a connection before opening a query tab.'
    case 'settings':
      return 'Settings is opening so you can review safety options.'
    default:
      return ''
  }
}

function isQueryTab(tab: QueryTabState) {
  return !tab.tabKind || tab.tabKind === 'query'
}

function runStepAction(
  stepId: GuideStepId,
  state: GuideRuntimeState,
  actions: GuideActions,
) {
  switch (stepId) {
    case 'welcome':
      actions.onOpenLibrary()
      break
    case 'folder':
      actions.onOpenLibrary()
      actions.onRequestCreateFolder()
      break
    case 'connection':
      actions.onOpenLibrary()
      actions.onOpenConnection(state.folders[0]?.id)
      break
    case 'save':
      actions.onOpenLibrary()
      if (state.firstConnectionId) {
        actions.onOpenConnectionPanel(state.firstConnectionId)
      } else {
        actions.onOpenConnection(state.folders[0]?.id)
      }
      break
    case 'explorer':
      if (state.firstConnectionId) {
        actions.onOpenExplorer(state.firstConnectionId)
      }
      break
    case 'query':
      if (state.firstConnectionId) {
        actions.onOpenQuery(state.firstConnectionId)
        actions.onShowResults()
      }
      break
    case 'settings':
      actions.onOpenSettings()
      break
    default:
      break
  }
}

function createPendingGuideAction(
  stepId: Extract<GuideStepId, 'explorer' | 'query' | 'settings'>,
  snapshot: WorkspaceSnapshot,
): PendingGuideAction {
  return {
    stepId,
    beforeTabIds: new Set(snapshot.tabs.map((tab) => tab.id)),
    previousActiveTabId: snapshot.ui.activeTabId || undefined,
    previousBottomPanelVisible: snapshot.ui.bottomPanelVisible,
    previousBottomPanelTab: snapshot.ui.activeBottomPanelTab,
  }
}

function pendingTabForStep(
  pending: PendingGuideAction,
  snapshot: WorkspaceSnapshot,
  connectionId?: string,
) {
  if (pending.stepId === 'explorer') {
    return (
      snapshot.tabs.find(
        (tab) =>
          tab.tabKind === 'explorer' &&
          (!connectionId || tab.connectionId === connectionId) &&
          tab.id === snapshot.ui.activeTabId,
      ) ??
      snapshot.tabs.find(
        (tab) =>
          tab.tabKind === 'explorer' &&
          (!connectionId || tab.connectionId === connectionId) &&
          !pending.beforeTabIds.has(tab.id),
      ) ??
      snapshot.tabs.find(
        (tab) => tab.tabKind === 'explorer' && (!connectionId || tab.connectionId === connectionId),
      )
    )
  }

  if (pending.stepId === 'query') {
    return (
      snapshot.tabs.find(
        (tab) => isQueryTab(tab) && tab.id === snapshot.ui.activeTabId,
      ) ??
      snapshot.tabs.find((tab) => isQueryTab(tab) && !pending.beforeTabIds.has(tab.id)) ??
      snapshot.tabs.find(isQueryTab)
    )
  }

  return (
    snapshot.tabs.find((tab) => tab.tabKind === 'settings' && tab.id === snapshot.ui.activeTabId) ??
    snapshot.tabs.find((tab) => tab.tabKind === 'settings' && !pending.beforeTabIds.has(tab.id)) ??
    snapshot.tabs.find((tab) => tab.tabKind === 'settings')
  )
}

function createOwnedTabSurface(
  stepId: GuideTabSurfaceKey,
  tabId: string,
  snapshot: WorkspaceSnapshot,
  createdByGuide: boolean,
  pending?: PendingGuideAction,
): OwnedTabSurface {
  const tab = snapshot.tabs.find((item) => item.id === tabId)

  return {
    tabId,
    createdByGuide,
    previousActiveTabId:
      pending?.previousActiveTabId ?? (snapshot.ui.activeTabId || undefined),
    previousBottomPanelVisible: pending?.previousBottomPanelVisible ?? snapshot.ui.bottomPanelVisible,
    previousBottomPanelTab: pending?.previousBottomPanelTab ?? snapshot.ui.activeBottomPanelTab,
    initialQueryText: stepId === 'query' ? tab?.queryText : undefined,
    initialScriptText: stepId === 'query' ? tab?.scriptText : undefined,
    initialHistoryLength: tab?.history.length ?? 0,
  }
}

function canCloseGuideOwnedTab(tab: QueryTabState, surface: OwnedTabSurface) {
  if (!tab.dirty) {
    return true
  }

  return (
    tab.queryText === surface.initialQueryText &&
    tab.scriptText === surface.initialScriptText &&
    tab.history.length === surface.initialHistoryLength &&
    tab.status === 'idle' &&
    !tab.result
  )
}

function sanitizeGuideStepId(stepId: string | undefined): GuideStepId | undefined {
  return GUIDE_STEP_IDS.includes(stepId as GuideStepId)
    ? (stepId as GuideStepId)
    : undefined
}

function stepById(stepId: GuideStepId) {
  return GUIDE_STEPS[stepIndex(stepId)]
}

function stepIndex(stepId: GuideStepId) {
  const index = GUIDE_STEPS.findIndex((step) => step.id === stepId)
  return index >= 0 ? index : 0
}

function previousStepId(stepId: GuideStepId): GuideStepId {
  return GUIDE_STEPS[Math.max(0, stepIndex(stepId) - 1)]?.id ?? 'welcome'
}

function nextStepId(stepId: GuideStepId): GuideStepId {
  return GUIDE_STEPS[Math.min(GUIDE_STEPS.length - 1, stepIndex(stepId) + 1)]?.id ?? 'settings'
}

function resolveSpotlight(anchor: string): SpotlightState | undefined {
  const target = document.querySelector<HTMLElement>(`[data-tour-id="${anchor}"]`)
  const rect = target?.getBoundingClientRect()

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return undefined
  }

  return {
    top: Math.max(8, rect.top - 6),
    left: Math.max(8, rect.left - 6),
    width: rect.width + 12,
    height: rect.height + 12,
  }
}

function spotlightStyle(spotlight: SpotlightState): CSSProperties {
  return {
    top: spotlight.top,
    left: spotlight.left,
    width: spotlight.width,
    height: spotlight.height,
  }
}

function popoverStyle(
  spotlight: SpotlightState | undefined,
  preferredPlacement: GuidePopoverPlacement,
  popoverSize: GuidePopoverSize,
): CSSProperties {
  return getGuidePopoverStyle(spotlight, preferredPlacement, popoverSize)
}
