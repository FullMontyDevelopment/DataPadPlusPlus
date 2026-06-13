export type GitHubReleaseAsset = {
  id: number
  name: string
  label?: string | null
  content_type: string
  size: number
  browser_download_url: string
}

export type GitHubRelease = {
  id: number
  tag_name: string
  name: string | null
  body?: string | null
  prerelease: boolean
  draft: boolean
  published_at: string | null
  html_url: string
  assets: GitHubReleaseAsset[]
}

const releasesEndpoint =
  'https://api.github.com/repos/FullMontyDevelopment/DataPadPlusPlus/releases?per_page=10'

export async function fetchReleases(signal?: AbortSignal) {
  const response = await fetch(releasesEndpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
    signal,
  })

  if (!response.ok) {
    throw new Error(`GitHub releases request failed with ${response.status}`)
  }

  const releases = (await response.json()) as GitHubRelease[]
  return releases.filter((release) => !release.draft)
}
