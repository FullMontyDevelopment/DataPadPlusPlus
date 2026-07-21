import { mkdirSync, rmSync } from 'node:fs'

export function prepareScreenshotWorkspace(workspaceDirectory, { reset = true } = {}) {
  if (reset) {
    rmSync(workspaceDirectory, { recursive: true, force: true })
  }
  mkdirSync(workspaceDirectory, { recursive: true })
}
