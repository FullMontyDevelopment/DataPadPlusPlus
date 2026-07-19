declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}



export async function invokeDesktop<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, payload)
}

type TaskbarQueryActivityInvoker = (runningCount: number) => Promise<void>

export function createTaskbarQueryActivityUpdater(
  invokeUpdate: TaskbarQueryActivityInvoker,
  onError: (error: unknown) => void = () => undefined,
) {
  let desiredRunningCount = 0
  let appliedActive: boolean | undefined
  let workerRunning = false
  let workerPromise = Promise.resolve()

  async function runWorker() {
    try {
      while (true) {
        const runningCount = desiredRunningCount
        const active = runningCount > 0

        if (active === appliedActive) {
          return
        }

        try {
          await invokeUpdate(runningCount)
        } catch (error) {
          onError(error)
        }

        appliedActive = active
      }
    } finally {
      workerRunning = false

      if (desiredRunningCount > 0 !== appliedActive) {
        startWorker()
      }
    }
  }

  function startWorker() {
    workerRunning = true
    workerPromise = runWorker()
  }

  return {
    update(runningCount: number) {
      desiredRunningCount = normalizeRunningCount(runningCount)

      if (!workerRunning) {
        startWorker()
      }

      return workerPromise
    },
  }
}

const taskbarQueryActivityUpdater = createTaskbarQueryActivityUpdater(
  (runningCount) =>
    invokeDesktop<void>('set_taskbar_query_activity', {
      request: { runningCount },
    }),
)

export function setTaskbarQueryActivity(runningCount: number) {
  if (!isTauriRuntime()) {
    return Promise.resolve()
  }

  return taskbarQueryActivityUpdater.update(runningCount)
}

function normalizeRunningCount(runningCount: number) {
  if (!Number.isFinite(runningCount) || runningCount <= 0) {
    return 0
  }

  return Math.floor(runningCount)
}
