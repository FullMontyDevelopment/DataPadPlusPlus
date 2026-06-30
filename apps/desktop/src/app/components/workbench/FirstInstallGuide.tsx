import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  LibraryNode,
  QueryTabState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'

type GuideStepId =
  | 'welcome'
  | 'folder'
  | 'connection'
  | 'save'
  | 'explorer'
  | 'query'
  | 'settings'

interface GuideStep {
  id: GuideStepId
  title: string
  body: string
  anchor: string
  actionLabel?: string
}

interface FirstInstallGuideProps {
  snapshot: WorkspaceSnapshot
  connectionDraftOpen: boolean
  startRequestRevision: number
  onStart(): void
  onSkip(): void
  onComplete(): void
  onOpenLibrary(): void
  onRequestCreateFolder(): void
  onOpenConnection(parentId?: string): void
  onOpenExplorer(connectionId: string): void
  onOpenQuery(connectionId: string): void
  onOpenSettings(): void
  onShowResults(): void
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to DataPad++',
    body: 'This quick tour uses the real workspace so the important buttons land where your hands expect them.',
    anchor: 'welcome-surface',
    actionLabel: 'Show Library',
  },
  {
    id: 'folder',
    title: 'Organize the Library',
    body: 'Create a folder first. Folders keep connections, queries, scripts, notes, and tests grouped together.',
    anchor: 'library-add-folder',
    actionLabel: 'Create Folder',
  },
  {
    id: 'connection',
    title: 'Create a connection',
    body: 'Open a new unsaved connection draft. You can choose a datastore, connection mode, environment, and safety flags before saving.',
    anchor: 'library-add-connection',
    actionLabel: 'New Connection',
  },
  {
    id: 'save',
    title: 'Test and save',
    body: 'The drawer lets you test credentials with the selected environment, then save only when the profile is ready.',
    anchor: 'connection-drawer',
  },
  {
    id: 'explorer',
    title: 'Browse metadata',
    body: 'Explorer gives you a structure view of the selected datastore before you write or run a query.',
    anchor: 'editor-tabs',
    actionLabel: 'Open Explorer',
  },
  {
    id: 'query',
    title: 'Query and review results',
    body: 'Query tabs combine the editor, run controls, and results panel so you can inspect data and history in one place.',
    anchor: 'editor-toolbar',
    actionLabel: 'Open Query Tab',
  },
  {
    id: 'settings',
    title: 'Check safety settings',
    body: 'Settings contain safe mode, backups, diagnostics, shortcuts, and experimental features for the workspace.',
    anchor: 'settings-workspace',
    actionLabel: 'Open Settings',
  },
]

export function FirstInstallGuide({
  snapshot,
  connectionDraftOpen,
  startRequestRevision,
  onStart,
  onSkip,
  onComplete,
  onOpenLibrary,
  onRequestCreateFolder,
  onOpenConnection,
  onOpenExplorer,
  onOpenQuery,
  onOpenSettings,
  onShowResults,
}: FirstInstallGuideProps) {
  const guideStatus = snapshot.preferences.firstInstallGuide?.status ?? 'unseen'
  const state = useMemo(
    () => guideState(snapshot, connectionDraftOpen),
    [connectionDraftOpen, snapshot],
  )
  const [startedThisSession, setStartedThisSession] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(() =>
    resumeStepIndex(state),
  )
  const [spotlight, setSpotlight] = useState<SpotlightState>()
  const [lastStartRequestRevision, setLastStartRequestRevision] =
    useState(startRequestRevision)

  const shouldPrompt = guideStatus === 'unseen' && workspaceIsEmpty(snapshot)
  const isRunning = guideStatus === 'started'
  const suggestedStepIndex = resumeStepIndex(state)
  const currentStep = GUIDE_STEPS[Math.min(currentStepIndex, GUIDE_STEPS.length - 1)]

  useEffect(() => {
    if (!isRunning) {
      setStartedThisSession(false)
      return
    }

    setCurrentStepIndex((current) => {
      if (startedThisSession && current === 0) {
        return current
      }

      return Math.max(current, suggestedStepIndex)
    })
  }, [isRunning, startedThisSession, suggestedStepIndex])

  useEffect(() => {
    if (startRequestRevision === lastStartRequestRevision) {
      return
    }

    setLastStartRequestRevision(startRequestRevision)
    setStartedThisSession(true)
    setCurrentStepIndex(0)
  }, [lastStartRequestRevision, startRequestRevision])

  useEffect(() => {
    if (!isRunning || !currentStep) {
      setSpotlight(undefined)
      return
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
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
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
                setStartedThisSession(true)
                setCurrentStepIndex(0)
                onStart()
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
        className="first-install-guide-popover"
        style={popoverStyle(spotlight)}
        role="dialog"
        aria-modal="false"
        aria-labelledby="first-install-guide-title"
      >
        <p className="first-install-guide-progress">
          Step {stepNumber} of {GUIDE_STEPS.length}
        </p>
        <h2 id="first-install-guide-title">{currentStep.title}</h2>
        <p>{currentStep.body}</p>
        {stepComplete ? (
          <p className="first-install-guide-done">Done. You can keep moving.</p>
        ) : null}
        <div className="first-install-guide-actions">
          <button
            type="button"
            className="drawer-button"
            disabled={currentStepIndex === 0}
            onClick={() => setCurrentStepIndex((current) => Math.max(0, current - 1))}
          >
            Back
          </button>
          <button type="button" className="drawer-button" onClick={onSkip}>
            Skip
          </button>
          {currentStep.actionLabel ? (
            <button
              type="button"
              className="drawer-button"
              onClick={() => runStepAction(currentStep.id, state, {
                onOpenLibrary,
                onRequestCreateFolder,
                onOpenConnection,
                onOpenExplorer,
                onOpenQuery,
                onOpenSettings,
                onShowResults,
              })}
            >
              {currentStep.actionLabel}
            </button>
          ) : null}
          {isFinalStep ? (
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              onClick={onComplete}
            >
              Finish
            </button>
          ) : (
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              disabled={!stepCanAdvance(currentStep.id, state)}
              onClick={() =>
                setCurrentStepIndex((current) =>
                  Math.min(GUIDE_STEPS.length - 1, current + 1),
                )
              }
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
  hasExplorerTab: boolean
  hasQueryTab: boolean
  hasSettingsTab: boolean
  connectionDrawerOpen: boolean
}

interface GuideActions {
  onOpenLibrary(): void
  onRequestCreateFolder(): void
  onOpenConnection(parentId?: string): void
  onOpenExplorer(connectionId: string): void
  onOpenQuery(connectionId: string): void
  onOpenSettings(): void
  onShowResults(): void
}

interface SpotlightState {
  top: number
  left: number
  width: number
  height: number
}

function guideState(
  snapshot: WorkspaceSnapshot,
  connectionDraftOpen: boolean,
): GuideRuntimeState {
  return {
    folders: snapshot.libraryNodes.filter((node) => node.kind === 'folder'),
    firstConnectionId: snapshot.connections[0]?.id,
    hasExplorerTab: snapshot.tabs.some((tab) => tab.tabKind === 'explorer'),
    hasQueryTab: snapshot.tabs.some(isQueryTab),
    hasSettingsTab: snapshot.tabs.some((tab) => tab.tabKind === 'settings'),
    connectionDrawerOpen: snapshot.ui.rightDrawer === 'connection' && connectionDraftOpen,
  }
}

function workspaceIsEmpty(snapshot: WorkspaceSnapshot) {
  return (
    snapshot.connections.length === 0 &&
    snapshot.tabs.length === 0 &&
    snapshot.libraryNodes.length === 0
  )
}

function resumeStepIndex(state: GuideRuntimeState) {
  if (state.folders.length === 0) {
    return 1
  }

  if (!state.firstConnectionId && !state.connectionDrawerOpen) {
    return 2
  }

  if (!state.firstConnectionId) {
    return 3
  }

  if (!state.hasExplorerTab) {
    return 4
  }

  if (!state.hasQueryTab) {
    return 5
  }

  if (!state.hasSettingsTab) {
    return 6
  }

  return 6
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

function popoverStyle(spotlight: SpotlightState | undefined): CSSProperties {
  if (!spotlight) {
    return {
      top: 72,
      left: 320,
    }
  }

  const width = 360
  const gap = 14
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const right = spotlight.left + spotlight.width + gap
  const left =
    right + width < viewportWidth
      ? right
      : Math.max(16, spotlight.left - width - gap)

  return {
    top: Math.min(Math.max(16, spotlight.top), Math.max(16, viewportHeight - 260)),
    left,
  }
}
