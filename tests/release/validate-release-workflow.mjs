import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_PLATFORMS = [
  'ubuntu-22.04',
  'windows-2022',
  'macos-latest'
]

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message)
  }
}

function rejectMatch(text, pattern, message) {
  if (pattern.test(text)) {
    throw new Error(message)
  }
}

export function validateReleaseWorkflow(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, '.github/workflows/release.yml')
  const text = readFileSync(path, 'utf8')

  requireMatch(text, /^\s*workflow_dispatch:\s*$/m, 'release.yml must use workflow_dispatch')
  requireMatch(text, /^\s*version:\s*$/m, 'release.yml must define a version input')
  requireMatch(text, /^\s*required:\s*true\s*$/m, 'release version input must be required')
  requireMatch(text, /^\s*macos_signing:\s*$/m, 'release.yml must define a macos_signing input')
  requireMatch(text, /^\s*default:\s*auto\s*$/m, 'macOS signing input must default to auto')
  requireMatch(text, /^\s*-\s*disabled\s*$/m, 'macOS signing input must support unsigned builds')
  requireMatch(text, /^\s*-\s*required\s*$/m, 'macOS signing input must support required signing')
  requireMatch(text, /^\s*contents:\s*write\s*$/m, 'release workflow must grant contents: write')
  requireMatch(
    text,
    /tauri-apps\/tauri-action@v0/,
    'release workflow must use tauri-apps/tauri-action@v0'
  )
  requireMatch(text, /projectPath:\s*apps\/desktop/, 'release workflow must set projectPath')
  requireMatch(
    text,
    /tagName:\s*app-v\$\{\{\s*inputs\.version\s*\}\}/,
    'release workflow must tag releases from the manual version input'
  )
  requireMatch(text, /releaseDraft:\s*true/, 'release workflow must create draft releases')
  requireMatch(
    text,
    /prerelease:\s*\$\{\{\s*contains\(inputs\.version,\s*'-'\)\s*\}\}/,
    'release workflow must mark prerelease versions from semver prerelease input'
  )
  requireMatch(
    text,
    /npm\s+run\s+release:validate\s+--\s+"\$\{\{\s*inputs\.version\s*\}\}"/,
    'release workflow must run the shared release version validator'
  )
  requireMatch(
    text,
    /npm\s+run\s+release:bump\s+--\s+"\$\{\{\s*inputs\.version\s*\}\}"/,
    'release workflow must auto-update release version files'
  )
  requireMatch(
    text,
    /release-sha:\s*\$\{\{\s*steps\.release\.outputs\.release_sha\s*\}\}/,
    'release workflow must expose the committed release SHA'
  )
  requireMatch(
    text,
    /gh\s+release\s+create\s+"\$\{release_args\[@\]\}"/,
    'release workflow must explicitly create a draft GitHub Release'
  )
  requireMatch(
    text,
    /ref:\s*\$\{\{\s*needs\.validate\.outputs\.release-sha\s*\}\}/,
    'release workflow publish jobs must check out the committed release SHA'
  )
  requireMatch(
    text,
    /name:\s*Validate macOS signing secrets/,
    'release workflow must validate macOS signing secrets before building'
  )
  requireMatch(
    text,
    /name:\s*Validate updater signing secrets/,
    'release workflow must validate updater signing secrets before building'
  )
  requireMatch(
    text,
    /name:\s*Configure Windows bundled C\+\+ build flags/,
    'release workflow must configure Windows bundled C++ build flags before building'
  )
  requireMatch(
    text,
    /CXXFLAGS_x86_64_pc_windows_msvc=\/std:c\+\+17 \/EHsc/,
    'release workflow must compile bundled Windows C++ dependencies with C++17'
  )
  requireMatch(
    text,
    /npm\s+exec\s+--workspace\s+@datapadplusplus\/desktop\s+--\s+tauri\s+signer\s+sign\s+"\$\{smoke_file\}"/,
    'release workflow must smoke-test the Tauri updater private key before building'
  )
  requireMatch(
    text,
    /node\s+tests\/release\/validate-updater-signing-env\.mjs/,
    'release workflow must validate updater signing key formats before building'
  )
  requireMatch(
    text,
    /Use the printed public key for DATAPADPLUSPLUS_UPDATER_PUBKEY and the private key file content for TAURI_SIGNING_PRIVATE_KEY/,
    'release workflow must explain the public/private updater key split'
  )
  requireMatch(
    text,
    /Invalid Tauri updater private key/,
    'release workflow must fail early with a clear updater private key message'
  )
  requireMatch(
    text,
    /DATAPADPLUSPLUS_UPDATER_PUBKEY:\s*\$\{\{\s*vars\.DATAPADPLUSPLUS_UPDATER_PUBKEY\s*\}\}/,
    'release workflow must pass the updater public key to Tauri builds'
  )
  requireMatch(
    text,
    /name:\s*Inject updater public key into Tauri config/,
    'release workflow must inject the updater public key into Tauri config before bundling'
  )
  requireMatch(
    text,
    /node\s+tests\/release\/inject-tauri-updater-pubkey\.mjs\s+apps\/desktop\/src-tauri\/tauri\.conf\.json/,
    'release workflow must use the tested updater public key injection script'
  )
  requireMatch(
    text,
    /DATAPADPLUSPLUS_REQUIRE_UPDATER_SIGNING:\s*["']true["']/,
    'release workflow must fail Tauri builds that do not embed an updater public key'
  )
  requireMatch(
    text,
    /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD\s*\}\}/,
    'release workflow must pass the Tauri updater signing key password'
  )
  requireMatch(
    text,
    /Configure the public updater key plus both Tauri signing secrets before building a release/,
    'release workflow must require complete updater signing configuration'
  )
  requireMatch(
    text,
    /Invalid macOS signing certificate/,
    'release workflow must fail early with a clear macOS certificate message'
  )
  requireMatch(
    text,
    /if:\s*runner\.os\s*!=\s*'macOS'\s*\|\|\s*steps\.mac_signing\.outputs\.enabled\s*!=\s*'true'/,
    'release workflow must keep Apple signing secrets out of unsigned builds'
  )
  requireMatch(
    text,
    /name:\s*Build and publish signed macOS Tauri release/,
    'release workflow must have a separate signed macOS build step'
  )
  requireMatch(
    text,
    /args:\s*'--bundles nsis,msi'/,
    'release workflow must build Windows NSIS and MSI installers'
  )
  requireMatch(
    text,
    /args:\s*'--bundles deb,rpm,appimage'/,
    'release workflow must build Linux deb, rpm, and AppImage bundles'
  )
  requireMatch(
    text,
    /--bundles app,dmg/,
    'release workflow must build macOS app and DMG bundles'
  )
  requireMatch(
    text,
    /name:\s*Package raw executable/,
    'release workflow must package raw executables'
  )
  requireMatch(
    text,
    /actions\/setup-dotnet@v4[\s\S]*dotnet-version:\s*['"]8\.0\.x['"]/,
    'release workflow must install .NET 8 for the bundled Oracle runtime'
  )
  requireMatch(
    text,
    /datapadplusplus-oracle-runtime-x86_64-pc-windows-msvc\.exe/,
    'release workflow must package the Windows Oracle runtime'
  )
  requireMatch(
    text,
    /datapadplusplus-oracle-runtime-x86_64-unknown-linux-gnu/,
    'release workflow must package the Linux Oracle runtime'
  )
  requireMatch(
    text,
    /datapadplusplus-oracle-runtime-aarch64-apple-darwin/,
    'release workflow must package the macOS ARM64 Oracle runtime'
  )
  requireMatch(
    text,
    /Oracle\.ManagedDataAccess\.Core-LICENSE\.txt/,
    'release workflow must include the Oracle managed-driver license'
  )
  requireMatch(
    text,
    /name:\s*Upload Tauri bundle artifacts to draft release/,
    'release workflow must explicitly upload Tauri installer and bundle assets'
  )
  requireMatch(
    text,
    /"\*\.zip"/,
    'release workflow must upload Windows updater zip artifacts to the draft release'
  )
  requireMatch(
    text,
    /"latest\.json"/,
    'release workflow must preserve Tauri latest.json updater metadata'
  )
  requireMatch(
    text,
    /name:\s*Verify updater signatures/,
    'release workflow must verify updater signatures when signing is configured'
  )
  requireMatch(
    text,
    /no \$platformName updater \.sig files were produced/,
    'release workflow must fail when platform updater artifacts are missing signatures'
  )
  requireMatch(
    text,
    /\*\.AppImage\.sig/,
    'release workflow must verify Linux AppImage updater signatures'
  )
  requireMatch(
    text,
    /\*\.app\.tar\.gz\.sig/,
    'release workflow must verify macOS app updater signatures'
  )
  requireMatch(
    text,
    /\*\.exe\.sig/,
    'release workflow must verify Windows installer updater signatures'
  )
  requireMatch(
    text,
    /bundle\.createUpdaterArtifacts is enabled/,
    'release workflow must point missing updater signatures back to createUpdaterArtifacts'
  )
  requireMatch(
    text,
    /name:\s*Generate updater manifest/,
    'release workflow must generate updater metadata after all platform builds finish'
  )
  requireMatch(
    text,
    /node\s+tests\/release\/prepare-updater-manifest-inputs\.mjs\s+"\$\{GITHUB_REPOSITORY\}"\s+"\$TAG_NAME"\s+updater-manifest/,
    'release workflow must prepare updater manifest inputs through the tested draft-release helper'
  )
  rejectMatch(
    text,
    /repos\/\$\{GITHUB_REPOSITORY\}\/releases\/tags\/\$\{TAG_NAME\}/,
    'release workflow must not use the published-release-only releases/tags endpoint for draft releases'
  )
  rejectMatch(
    text,
    /platform:\s*windows-latest/,
    'release workflow must not use the moving windows-latest runner for Windows releases'
  )
  requireMatch(
    text,
    /gh\s+release\s+upload\s+"\$TAG_NAME"\s+updater-manifest\/latest\.json\s+--clobber/,
    'release workflow must upload generated latest.json to the draft release'
  )
  requireMatch(
    text,
    /node\s+tests\/release\/generate-updater-manifest\.mjs\s+updater-manifest\/release\.json\s+updater-manifest\s+"\$RELEASE_VERSION"\s+updater-manifest\/latest\.json/,
    'release workflow must use the tested updater manifest generator'
  )
  requireMatch(
    text,
    /No Tauri installer or bundle assets were found/,
    'release workflow must fail if Tauri produces no installer or bundle assets'
  )
  requireMatch(
    text,
    /gh release upload \$env:TAG_NAME \$asset --clobber/,
    'release workflow must upload raw executable archives to the draft release'
  )

  for (const platform of REQUIRED_PLATFORMS) {
    requireMatch(
      text,
      new RegExp(`platform:\\s*${platform.replaceAll('.', '\\.')}`),
      `release workflow is missing ${platform}`
    )
  }

  return {
    path,
    platforms: REQUIRED_PLATFORMS
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = validateReleaseWorkflow(process.cwd())
    console.log(`Release workflow OK: ${result.path}`)
    console.log(`Platforms: ${result.platforms.join(', ')}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
