import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isValidReleaseVersion,
  validateReleaseVersion
} from './validate-release-version.mjs'

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function updateJsonVersion(repoRoot, path, version) {
  const absolutePath = resolve(repoRoot, path)
  const value = JSON.parse(readFileSync(absolutePath, 'utf8'))
  value.version = version
  writeJson(absolutePath, value)
}

function updatePackageLock(repoRoot, version) {
  const path = resolve(repoRoot, 'package-lock.json')
  const lock = JSON.parse(readFileSync(path, 'utf8'))
  lock.version = version

  for (const packagePath of ['', 'apps/desktop', 'packages/shared-types']) {
    if (!lock.packages || !lock.packages[packagePath]) {
      throw new Error(`package-lock.json is missing packages["${packagePath}"]`)
    }
    lock.packages[packagePath].version = version
  }

  writeJson(path, lock)
}

function updateCargoPackageVersion(repoRoot, path, version) {
  const absolutePath = resolve(repoRoot, path)
  const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  let inPackageSection = false
  let changed = false

  const nextLines = lines.map((line) => {
    if (/^\s*\[/.test(line)) {
      inPackageSection = /^\s*\[package\]\s*$/.test(line)
      return line
    }

    if (inPackageSection && /^\s*version\s*=/.test(line)) {
      changed = true
      return line.replace(/"[^"]+"/, `"${version}"`)
    }

    return line
  })

  if (!changed) {
    throw new Error(`${path} [package] section does not contain a version`)
  }

  writeFileSync(absolutePath, nextLines.join('\n'))
}

function updateCargoLockPackageVersion(repoRoot, path, packageName, version) {
  const absolutePath = resolve(repoRoot, path)
  const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  let inPackage = false
  let foundPackage = false
  let changed = false

  const nextLines = lines.map((line) => {
    if (/^\s*\[\[package\]\]\s*$/.test(line)) {
      inPackage = true
      foundPackage = false
      return line
    }

    if (!inPackage) {
      return line
    }

    const name = line.match(/^\s*name\s*=\s*"([^"]+)"\s*$/)
    if (name) {
      foundPackage = name[1] === packageName
      return line
    }

    if (foundPackage && /^\s*version\s*=/.test(line)) {
      changed = true
      foundPackage = false
      return line.replace(/"[^"]+"/, `"${version}"`)
    }

    return line
  })

  if (!changed) {
    throw new Error(`${path} does not contain package ${packageName}`)
  }

  writeFileSync(absolutePath, nextLines.join('\n'))
}

export function bumpReleaseVersion(version, repoRoot = process.cwd()) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('Release version is required')
  }

  const normalizedVersion = version.trim()
  if (!isValidReleaseVersion(normalizedVersion)) {
    throw new Error(
      `Release version "${version}" must be semver like 1.2.3 or 1.2.3-beta.1`
    )
  }

  updateJsonVersion(repoRoot, 'package.json', normalizedVersion)
  updateJsonVersion(repoRoot, 'apps/desktop/package.json', normalizedVersion)
  updateJsonVersion(repoRoot, 'packages/shared-types/package.json', normalizedVersion)
  updateJsonVersion(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json', normalizedVersion)
  updatePackageLock(repoRoot, normalizedVersion)
  updateCargoPackageVersion(
    repoRoot,
    'apps/desktop/src-tauri/Cargo.toml',
    normalizedVersion
  )
  updateCargoLockPackageVersion(
    repoRoot,
    'apps/desktop/src-tauri/Cargo.lock',
    'datapadplusplus-desktop',
    normalizedVersion
  )

  return validateReleaseVersion(normalizedVersion, repoRoot)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = bumpReleaseVersion(process.argv[2])
    console.log(`Release version files updated: ${result.version}`)
    console.log(`Release tag: ${result.tagName}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
