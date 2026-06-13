import type { Platform } from './platform'
import type { GitHubRelease, GitHubReleaseAsset } from './releases'

export type DownloadKind =
  | 'Windows installer'
  | 'Windows MSI'
  | 'Windows archive'
  | 'macOS DMG'
  | 'macOS archive'
  | 'Linux AppImage'
  | 'Linux DEB'
  | 'Linux RPM'
  | 'Linux archive'
  | 'Other download'

export type ClassifiedDownload = {
  asset: GitHubReleaseAsset
  platform: Platform
  kind: DownloadKind
  priority: number
}

function normalizedName(asset: Pick<GitHubReleaseAsset, 'name'>) {
  return asset.name.toLowerCase()
}

export function isPrimaryDownloadAsset(asset: Pick<GitHubReleaseAsset, 'name'>) {
  const name = normalizedName(asset)
  return (
    name !== 'latest.json' &&
    !name.endsWith('.sig') &&
    !name.endsWith('.sha256') &&
    !name.includes('source code')
  )
}

export function classifyDownloadAsset(asset: GitHubReleaseAsset): ClassifiedDownload | undefined {
  if (!isPrimaryDownloadAsset(asset)) return undefined

  const name = normalizedName(asset)

  if (name.endsWith('.msi')) {
    return { asset, platform: 'windows', kind: 'Windows MSI', priority: 20 }
  }

  if (name.endsWith('.exe') || name.includes('setup') || name.includes('nsis')) {
    return { asset, platform: 'windows', kind: 'Windows installer', priority: 10 }
  }

  if ((name.includes('windows') || name.includes('win32')) && name.endsWith('.zip')) {
    return { asset, platform: 'windows', kind: 'Windows archive', priority: 30 }
  }

  if (name.endsWith('.dmg')) {
    return { asset, platform: 'macos', kind: 'macOS DMG', priority: 10 }
  }

  if (
    name.includes('macos') ||
    name.includes('darwin') ||
    name.includes('apple') ||
    name.endsWith('.app.tar.gz') ||
    name.endsWith('.app.zip')
  ) {
    return { asset, platform: 'macos', kind: 'macOS archive', priority: 20 }
  }

  if (name.endsWith('.appimage')) {
    return { asset, platform: 'linux', kind: 'Linux AppImage', priority: 10 }
  }

  if (name.endsWith('.deb')) {
    return { asset, platform: 'linux', kind: 'Linux DEB', priority: 20 }
  }

  if (name.endsWith('.rpm')) {
    return { asset, platform: 'linux', kind: 'Linux RPM', priority: 30 }
  }

  if ((name.includes('linux') || name.includes('x86_64-unknown-linux')) && (name.endsWith('.tar.gz') || name.endsWith('.tgz'))) {
    return { asset, platform: 'linux', kind: 'Linux archive', priority: 40 }
  }

  if (name.endsWith('.zip') || name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
    return { asset, platform: 'unknown', kind: 'Other download', priority: 90 }
  }

  return undefined
}

export function classifyReleaseDownloads(release: Pick<GitHubRelease, 'assets'>) {
  return release.assets
    .map((asset) => classifyDownloadAsset(asset))
    .filter((asset): asset is ClassifiedDownload => Boolean(asset))
    .sort((left, right) => left.priority - right.priority || left.asset.name.localeCompare(right.asset.name))
}

export function getRecommendedDownload(
  release: Pick<GitHubRelease, 'assets'> | undefined,
  platform: Platform,
) {
  if (!release) return undefined

  const downloads = classifyReleaseDownloads(release)
  const platformDownload = downloads.find((download) => download.platform === platform)
  return platformDownload ?? downloads[0]
}

export function getDownloadsForPlatform(release: Pick<GitHubRelease, 'assets'> | undefined, platform: Platform) {
  if (!release) return []
  return classifyReleaseDownloads(release).filter((download) => download.platform === platform)
}

export function formatBytes(size: number) {
  if (size <= 0) return 'Unknown size'

  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
