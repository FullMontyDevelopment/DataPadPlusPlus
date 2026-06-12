export type AppUpdateChannel = 'stable' | 'prerelease'
export type AppUpdateStatus = 'unsupported' | 'current' | 'available' | 'error'

export interface AppUpdateLastResult {
  status: AppUpdateStatus
  channel: AppUpdateChannel
  checkedAt: string
  version?: string
  message?: string
}

export interface AppUpdateSettings {
  includePrereleases: boolean
  supported: boolean
  supportMessage?: string
  lastCheckedAt?: string
  lastResult?: AppUpdateLastResult
}

export interface AppUpdateCandidate {
  version: string
  currentVersion: string
  channel: AppUpdateChannel
  releaseUrl: string
  manifestUrl: string
  notes?: string
  pubDate?: string
  downloadUrl?: string
}

export interface AppUpdateCheckResult {
  status: AppUpdateStatus
  channel: AppUpdateChannel
  currentVersion: string
  checkedAt: string
  message: string
  settings: AppUpdateSettings
  candidate?: AppUpdateCandidate
}

export type AppUpdateDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | {
      event: 'Progress'
      data: {
        chunkLength: number
        contentLength?: number
        downloadedBytes: number
      }
    }
  | { event: 'Finished' }
