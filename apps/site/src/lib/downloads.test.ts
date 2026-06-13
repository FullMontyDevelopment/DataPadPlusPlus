import { describe, expect, it } from 'vitest'
import {
  classifyDownloadAsset,
  classifyReleaseDownloads,
  getRecommendedDownload,
  isPrimaryDownloadAsset,
} from './downloads'
import type { GitHubReleaseAsset } from './releases'

function asset(name: string, id = Math.floor(Math.random() * 100000)): GitHubReleaseAsset {
  return {
    id,
    name,
    content_type: 'application/octet-stream',
    size: 1024,
    browser_download_url: `https://example.com/${name}`,
  }
}

describe('download asset classification', () => {
  it('filters updater signatures and latest manifest out of primary downloads', () => {
    expect(isPrimaryDownloadAsset(asset('latest.json'))).toBe(false)
    expect(isPrimaryDownloadAsset(asset('DataPadPlusPlus.AppImage.sig'))).toBe(false)
    expect(isPrimaryDownloadAsset(asset('DataPadPlusPlus-0.1.32-x64-setup.exe'))).toBe(true)
  })

  it('classifies expected platform assets', () => {
    expect(classifyDownloadAsset(asset('DataPadPlusPlus-0.1.32-x64-setup.exe'))?.platform).toBe('windows')
    expect(classifyDownloadAsset(asset('DataPadPlusPlus_0.1.32_x64.msi'))?.kind).toBe('Windows MSI')
    expect(classifyDownloadAsset(asset('DataPadPlusPlus_0.1.32_aarch64.dmg'))?.platform).toBe('macos')
    expect(classifyDownloadAsset(asset('DataPadPlusPlus_0.1.32_amd64.AppImage'))?.kind).toBe('Linux AppImage')
    expect(classifyDownloadAsset(asset('DataPadPlusPlus_0.1.32_amd64.deb'))?.kind).toBe('Linux DEB')
  })

  it('recommends the best asset for the detected platform', () => {
    const release = {
      assets: [
        asset('DataPadPlusPlus-0.1.32-windows-x64-executable.zip', 1),
        asset('DataPadPlusPlus_0.1.32_x64.msi', 2),
        asset('DataPadPlusPlus-0.1.32-x64-setup.exe', 3),
        asset('DataPadPlusPlus_0.1.32_amd64.deb', 4),
        asset('DataPadPlusPlus_0.1.32_amd64.AppImage', 5),
      ],
    }

    expect(getRecommendedDownload(release, 'windows')?.asset.id).toBe(3)
    expect(getRecommendedDownload(release, 'linux')?.asset.id).toBe(5)
  })

  it('keeps all valid downloads sorted by priority', () => {
    const release = {
      assets: [
        asset('latest.json', 1),
        asset('DataPadPlusPlus_0.1.32_amd64.rpm', 2),
        asset('DataPadPlusPlus_0.1.32_amd64.AppImage', 3),
        asset('DataPadPlusPlus_0.1.32_amd64.AppImage.sig', 4),
      ],
    }

    expect(classifyReleaseDownloads(release).map((download) => download.asset.id)).toEqual([3, 2])
  })
})
