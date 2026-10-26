import { isTauriRuntime } from './desktop-bridge'

export interface ScriptProgress {
  executionId: string
  tabId: string
  sequence: number
  method: string
  status: string
  console: string
}

export async function listenScriptProgress(callback: (progress: ScriptProgress) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<ScriptProgress>('query-script-progress', event => callback(event.payload))
}
