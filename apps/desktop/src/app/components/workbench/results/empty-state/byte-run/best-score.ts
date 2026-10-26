export const BEST_SCORE_KEY = 'datapadplusplus-byte-run-best-v1'
let sessionBest = 0

export function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function readBestScore() {
  try {
    const raw = window.localStorage.getItem(BEST_SCORE_KEY)
    const stored: unknown = raw === null ? 0 : JSON.parse(raw)
    if (validScore(stored)) sessionBest = Math.max(sessionBest, stored)
  } catch { /* Unavailable storage must never affect the game or workbench. */ }
  return sessionBest
}

export function saveBestScore(value: number) {
  const current = readBestScore()
  if (validScore(value) && value > current) {
    sessionBest = value
  }
  // Retry a previous session-only best when storage becomes available again.
  if (sessionBest > 0) {
    try { window.localStorage.setItem(BEST_SCORE_KEY, String(sessionBest)) } catch { /* Session-only fallback. */ }
  }
  return sessionBest
}
