import { describe, expect, it } from 'vitest'
import { docArticles } from './docs'
import { screenshotSlots } from './screenshots'

describe('docs content', () => {
  it('has unique slugs', () => {
    const slugs = docArticles.map((article) => article.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('references only known screenshot placeholders', () => {
    const knownSlots = new Set(Object.keys(screenshotSlots))
    const missing = docArticles.flatMap((article) =>
      article.screenshots.filter((screenshot) => !knownSlots.has(screenshot)),
    )

    expect(missing).toEqual([])
  })

  it('keeps every article step-by-step', () => {
    expect(docArticles.length).toBeGreaterThanOrEqual(12)
    expect(docArticles.every((article) => article.steps.length >= 5)).toBe(true)
  })
})
