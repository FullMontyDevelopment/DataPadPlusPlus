import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { docArticles, docCategories } from './docs'
import { screenshotSlots } from './screenshots'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')
const refreshedRepositoryDocs = [
  'docs/features.md',
  'docs/settings-and-workspace.md',
  'docs/oracle.md',
  'docs/architecture/security-and-safety.md',
  'docs/multi-window-tabs.md',
  'docs/query-and-document-editing.md',
  'docs/key-value-inspection.md',
  'docs/datastore-transfers.md',
]

function markdownTargets(markdown: string) {
  return [...markdown.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)].map((match) => match[1] ?? '')
}

function localTargetExists(sourceFile: string, target: string) {
  if (!target || /^(?:https?:|mailto:|#)/.test(target)) return true
  const withoutAnchor = target.split('#')[0] ?? ''
  return withoutAnchor.length === 0 || existsSync(resolve(dirname(sourceFile), decodeURIComponent(withoutAnchor)))
}

function pngDimensions(path: string) {
  const header = readFileSync(path).subarray(0, 24)
  expect(header.subarray(1, 4).toString('ascii'), path).toBe('PNG')
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

describe('documentation quality', () => {
  it('keeps the README concise and explicit about pre-release risk', () => {
    const readmePath = join(repositoryRoot, 'README.md')
    const readme = readFileSync(readmePath, 'utf8')
    const wordCount = readme.match(/\b[\p{L}\p{N}][\p{L}\p{N}+.-]*\b/gu)?.length ?? 0

    expect(wordCount).toBeLessThanOrEqual(1_200)
    expect(readme).toContain('should not be used for production workloads')
    expect(readme).toContain('unknown defects')
    expect(markdownTargets(readme).filter((target) => !localTargetExists(readmePath, target))).toEqual([])
  })

  it('keeps canonical article categories complete and referenced', () => {
    const knownCategories = new Set<string>(docCategories)
    expect(docArticles.every((article) => knownCategories.has(article.category))).toBe(true)
    expect(docArticles.filter((article) => article.featured)).toHaveLength(6)
  })

  it('keeps committed screenshot paths valid', () => {
    const missing = Object.values(screenshotSlots)
      .filter((slot) => slot.image)
      .filter((slot) => !existsSync(join(repositoryRoot, 'apps/site/public', slot.image!)))
      .map((slot) => slot.id)

    expect(missing).toEqual([])
  })

  it('keeps screenshots readable and datastore captures at desktop resolution', () => {
    for (const slot of Object.values(screenshotSlots)) {
      const path = join(repositoryRoot, 'apps/site/public', slot.image)
      const { width, height } = pngDimensions(path)
      expect(width, slot.id).toBeGreaterThanOrEqual(360)
      expect(height, slot.id).toBeGreaterThanOrEqual(300)
      if (slot.id.startsWith('datastore-')) {
        expect(width, slot.id).toBeGreaterThanOrEqual(1_200)
        expect(height, slot.id).toBeGreaterThanOrEqual(700)
      }
    }
  })

  it('keeps refreshed repository reference links valid', () => {
    const broken = refreshedRepositoryDocs.flatMap((relativePath) => {
      const sourceFile = join(repositoryRoot, relativePath)
      const markdown = readFileSync(sourceFile, 'utf8')
      return markdownTargets(markdown)
        .filter((target) => !localTargetExists(sourceFile, target))
        .map((target) => `${relativePath} -> ${target}`)
    })

    expect(broken).toEqual([])
  })

  it('provides meaningful text for every visual slot', () => {
    expect(
      Object.values(screenshotSlots).filter(
        (slot) => slot.title.trim().length < 4 || slot.caption.trim().length < 12,
      ),
    ).toEqual([])
    expect(Object.values(screenshotSlots).filter((slot) => /placeholder/i.test(`${slot.title} ${slot.caption} ${slot.captureCase}`))).toEqual([])
    expect(new Set(Object.values(screenshotSlots).map((slot) => slot.image)).size).toBe(Object.keys(screenshotSlots).length)
  })
})
