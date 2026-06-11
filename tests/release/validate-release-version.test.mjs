import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isValidReleaseVersion,
  validateReleaseVersion
} from './validate-release-version'
import { bumpReleaseVersion } from './bump-release-version'
import { validateReleaseWorkflow } from './validate-release-workflow'

function makeRepo(version = '1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'datapadplusplus-release-'))
  mkdirSync(join(root, 'apps', 'desktop', 'src-tauri'), { recursive: true })
  mkdirSync(join(root, 'packages', 'shared-types'), { recursive: true })

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'datapadplusplus', version }, null, 2)
  )
  writeFileSync(
    join(root, 'apps', 'desktop', 'package.json'),
    JSON.stringify({ name: '@datapadplusplus/desktop', version }, null, 2)
  )
  writeFileSync(
    join(root, 'packages', 'shared-types', 'package.json'),
    JSON.stringify({ name: '@datapadplusplus/shared-types', version }, null, 2)
  )
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'datapadplusplus',
        version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name: 'datapadplusplus', version, workspaces: ['apps/*', 'packages/*'] },
          'apps/desktop': { name: '@datapadplusplus/desktop', version },
          'packages/shared-types': { name: '@datapadplusplus/shared-types', version }
        }
      },
      null,
      2
    )
  )
  writeFileSync(
    join(root, 'apps', 'desktop', 'src-tauri', 'Cargo.toml'),
    `[package]\nname = "datapadplusplus-desktop"\nversion = "${version}"\nedition = "2021"\n`
  )
  writeFileSync(
    join(root, 'apps', 'desktop', 'src-tauri', 'Cargo.lock'),
    `[[package]]\nname = "datapadplusplus-desktop"\nversion = "${version}"\ndependencies = []\n`
  )
  writeFileSync(
    join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ productName: 'DataPad++', version }, null, 2)
  )

  return root
}

test('accepts matching stable versions', () => {
  const result = validateReleaseVersion('1.2.3', makeRepo('1.2.3'))

  assert.equal(result.version, '1.2.3')
  assert.equal(result.tagName, 'app-v1.2.3')
  assert.equal(result.prerelease, false)
  assert.equal(result.files.length, 10)
})

test('accepts matching prerelease versions', () => {
  const result = validateReleaseVersion('2.0.0-beta.1', makeRepo('2.0.0-beta.1'))

  assert.equal(result.version, '2.0.0-beta.1')
  assert.equal(result.tagName, 'app-v2.0.0-beta.1')
  assert.equal(result.prerelease, true)
})

test('rejects missing versions', () => {
  assert.throws(() => validateReleaseVersion('', makeRepo()), /required/)
})

test('rejects invalid semver input', () => {
  for (const version of ['1', '1.2', '01.2.3', '1.2.3+build.1', 'v1.2.3']) {
    assert.equal(isValidReleaseVersion(version), false)
    assert.throws(() => validateReleaseVersion(version, makeRepo()), /must be semver/)
  }
})

test('rejects mismatched version files', () => {
  assert.throws(
    () => validateReleaseVersion('1.2.3', makeRepo('1.2.4')),
    /Release version files do not match/
  )
})

test('bumps every release version surface', () => {
  const repo = makeRepo('1.2.3')
  const result = bumpReleaseVersion('1.3.0-beta.1', repo)

  assert.equal(result.version, '1.3.0-beta.1')
  assert.equal(result.prerelease, true)
  assert.equal(validateReleaseVersion('1.3.0-beta.1', repo).files.length, 10)
})

test('current release workflow matches the hardened release contract', () => {
  const result = validateReleaseWorkflow(process.cwd())

  assert.deepEqual(result.platforms, [
    'ubuntu-22.04',
    'windows-latest',
    'macos-latest'
  ])
})
