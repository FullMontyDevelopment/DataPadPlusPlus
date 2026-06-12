import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REQUIRED_UPDATER_PLATFORMS = [
  {
    key: 'windows-x86_64',
    patterns: [
      /\.exe$/i,
      /\.msi$/i,
      /\.nsis\.zip$/i,
      /\.msi\.zip$/i,
      /\.exe\.zip$/i
    ]
  },
  {
    key: 'linux-x86_64',
    patterns: [
      /\.AppImage$/i,
      /\.AppImage\.tar\.gz$/i
    ]
  },
  {
    key: 'darwin-aarch64',
    patterns: [
      /\.app\.tar\.gz$/i
    ]
  }
]

function validReleaseAsset(asset) {
  return asset &&
    typeof asset.name === 'string' &&
    typeof asset.browser_download_url === 'string' &&
    !asset.name.endsWith('.sig') &&
    asset.name !== 'latest.json'
}

function selectSignedAsset(assets, patterns, readSignature) {
  for (const pattern of patterns) {
    for (const asset of assets) {
      if (!validReleaseAsset(asset) || !pattern.test(asset.name)) {
        continue
      }

      const signature = readSignature(asset.name)
      if (signature) {
        return { asset, signature }
      }
    }
  }

  return undefined
}

export function generateUpdaterManifest({ release, version, readSignature }) {
  const assets = Array.isArray(release.assets) ? release.assets : []
  const platforms = {}
  const missing = []

  for (const platform of REQUIRED_UPDATER_PLATFORMS) {
    const signedAsset = selectSignedAsset(assets, platform.patterns, readSignature)
    if (!signedAsset) {
      missing.push(platform.key)
      continue
    }

    platforms[platform.key] = {
      signature: signedAsset.signature,
      url: signedAsset.asset.browser_download_url
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing signed updater asset(s) for ${missing.join(', ')}. ` +
      'Each supported platform must have an updater asset with a matching .sig file.'
    )
  }

  return {
    version,
    notes: release.body ?? '',
    pub_date: release.published_at ?? release.created_at ?? new Date().toISOString(),
    platforms
  }
}

export function generateUpdaterManifestFromFiles({
  releaseJsonPath,
  signatureDir,
  version,
  outputPath
}) {
  const release = JSON.parse(readFileSync(releaseJsonPath, 'utf8'))
  const manifest = generateUpdaterManifest({
    release,
    version,
    readSignature(assetName) {
      const signaturePath = join(signatureDir, `${assetName}.sig`)
      if (!existsSync(signaturePath)) {
        return undefined
      }

      const signature = readFileSync(signaturePath, 'utf8').trim()
      return signature.length > 0 ? signature : undefined
    }
  })

  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , releaseJsonPath, signatureDir, version, outputPath] = process.argv
  if (!releaseJsonPath || !signatureDir || !version || !outputPath) {
    console.error(
      'Usage: node tests/release/generate-updater-manifest.mjs <release-json> <signature-dir> <version> <output-json>'
    )
    process.exit(1)
  }

  try {
    generateUpdaterManifestFromFiles({
      releaseJsonPath,
      signatureDir,
      version,
      outputPath
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
