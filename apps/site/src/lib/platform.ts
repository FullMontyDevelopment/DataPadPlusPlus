export type Platform = 'windows' | 'macos' | 'linux' | 'unknown'

export function normalizePlatform(value: string | undefined): Platform {
  const platform = value?.toLowerCase() ?? ''

  if (platform.includes('win')) return 'windows'
  if (platform.includes('mac') || platform.includes('darwin')) return 'macos'
  if (platform.includes('linux') || platform.includes('x11') || platform.includes('ubuntu')) {
    return 'linux'
  }

  return 'unknown'
}

export function detectPlatform(navigatorLike: Pick<Navigator, 'platform' | 'userAgent'> = navigator): Platform {
  const userAgentDataPlatform = (
    navigatorLike as Pick<Navigator, 'platform' | 'userAgent'> & {
      userAgentData?: { platform?: string }
    }
  ).userAgentData?.platform

  const fromUserAgentData = normalizePlatform(userAgentDataPlatform)
  if (fromUserAgentData !== 'unknown') return fromUserAgentData

  const fromPlatform = normalizePlatform(navigatorLike.platform)
  if (fromPlatform !== 'unknown') return fromPlatform

  return normalizePlatform(navigatorLike.userAgent)
}

export function platformLabel(platform: Platform) {
  switch (platform) {
    case 'windows':
      return 'Windows'
    case 'macos':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return 'your platform'
  }
}
