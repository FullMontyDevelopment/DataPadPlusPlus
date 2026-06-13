import { isTauriRuntime } from './desktop-bridge'

const GITHUB_REPO_ORIGIN = 'https://github.com'
const GITHUB_REPO_PATH = '/FullMontyDevelopment/DataPadPlusPlus'

export function canOpenExternalLink(value: string) {
  try {
    const url = new URL(value)
    return (
      url.origin === GITHUB_REPO_ORIGIN &&
      (url.pathname === GITHUB_REPO_PATH || url.pathname.startsWith(`${GITHUB_REPO_PATH}/`))
    )
  } catch {
    return false
  }
}

export async function openExternalLink(value: string) {
  if (!canOpenExternalLink(value)) {
    throw new Error('External link is not allowed.')
  }

  if (isTauriRuntime()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(value)
    return
  }

  window.open(value, '_blank', 'noopener,noreferrer')
}
