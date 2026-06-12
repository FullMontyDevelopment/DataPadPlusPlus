import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { parse, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_API_VERSION = '2026-03-10'
const MAX_RELEASE_PAGES = 20

function githubHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'User-Agent': 'DataPad++ release workflow',
    'X-GitHub-Api-Version': GITHUB_API_VERSION
  }
}

function requireOk(response, context) {
  if (!response.ok) {
    throw new Error(`${context} failed with HTTP ${response.status}.`)
  }
}

function safeAssetFileName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Release asset is missing a file name.')
  }
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error(`Release asset name is not safe to write: ${name}`)
  }
  return name
}

function requireSafeOutputDir(outputDir) {
  if (typeof outputDir !== 'string' || outputDir.trim() === '') {
    throw new Error('An updater manifest output directory is required.')
  }

  const resolved = resolve(outputDir)
  if (resolved === parse(resolved).root) {
    throw new Error(`Refusing to write updater manifest inputs to filesystem root: ${outputDir}`)
  }

  return outputDir
}

export async function findReleaseByTag({
  repository,
  tagName,
  token,
  fetchImpl = globalThis.fetch
}) {
  if (!repository || !repository.includes('/')) {
    throw new Error('GITHUB_REPOSITORY must be in owner/repo format.')
  }
  if (!tagName) {
    throw new Error('A release tag name is required.')
  }
  if (!token) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN is required to read draft releases.')
  }

  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const url = `${GITHUB_API_BASE}/repos/${repository}/releases?per_page=100&page=${page}`
    const response = await fetchImpl(url, {
      headers: githubHeaders(token)
    })
    requireOk(response, `Listing releases page ${page}`)

    const releases = await response.json()
    if (!Array.isArray(releases)) {
      throw new Error('GitHub releases API returned an unexpected response.')
    }

    const release = releases.find((item) => item?.tag_name === tagName)
    if (release) {
      return release
    }
    if (releases.length < 100) {
      break
    }
  }

  throw new Error(
    `Release ${tagName} was not found in the authenticated release listing. ` +
    'The draft release may not have been created, or the token cannot read draft releases.'
  )
}

export async function downloadAsset({
  asset,
  outputDir,
  token,
  fetchImpl = globalThis.fetch
}) {
  const name = safeAssetFileName(asset?.name)
  if (!asset?.url) {
    throw new Error(`Release asset ${name} is missing its API download URL.`)
  }

  const response = await fetchImpl(asset.url, {
    headers: githubHeaders(token, 'application/octet-stream')
  })
  requireOk(response, `Downloading ${name}`)

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0) {
    throw new Error(`Release asset ${name} downloaded as an empty file.`)
  }

  const outputPath = join(outputDir, name)
  writeFileSync(outputPath, bytes)
  return outputPath
}

export async function prepareUpdaterManifestInputs({
  repository,
  tagName,
  outputDir,
  token,
  fetchImpl = globalThis.fetch
}) {
  const safeOutputDir = requireSafeOutputDir(outputDir)
  const release = await findReleaseByTag({ repository, tagName, token, fetchImpl })
  const signatureAssets = (Array.isArray(release.assets) ? release.assets : [])
    .filter((asset) => typeof asset?.name === 'string' && asset.name.endsWith('.sig'))

  if (signatureAssets.length === 0) {
    throw new Error(`Release ${tagName} does not have any .sig assets yet.`)
  }

  rmSync(safeOutputDir, { force: true, recursive: true })
  mkdirSync(safeOutputDir, { recursive: true })
  writeFileSync(join(safeOutputDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)

  const signaturePaths = []
  for (const asset of signatureAssets) {
    signaturePaths.push(await downloadAsset({ asset, outputDir: safeOutputDir, token, fetchImpl }))
  }

  return {
    release,
    signaturePaths
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , repository, tagName, outputDir] = process.argv
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN

  try {
    const result = await prepareUpdaterManifestInputs({
      repository: repository || process.env.GITHUB_REPOSITORY,
      tagName,
      outputDir,
      token
    })
    console.log(
      `Prepared updater manifest inputs for ${tagName}: ${result.signaturePaths.length} signature asset(s).`
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
