import { describe, expect, it } from 'vitest'
import { clientWorkspace } from './client-workspace'

describe('client workspace import validation', () => {
  it('rejects empty or oversized browser-preview bundles before parsing', async () => {
    await expect(
      clientWorkspace.importWorkspaceBundle('long-enough', ''),
    ).rejects.toThrow('Choose a workspace bundle before importing.')

    await expect(
      clientWorkspace.importWorkspaceBundle(
        'long-enough',
        'x'.repeat(25 * 1024 * 1024 + 1),
      ),
    ).rejects.toThrow('Workspace bundle is too large to import safely.')
  })
})
