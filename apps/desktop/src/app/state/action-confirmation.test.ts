import { describe, expect, it, vi } from 'vitest'
import { confirmDestructiveAction } from './action-confirmation'

describe('destructive action confirmation', () => {
  it('combines title and detail into a clear confirmation message', () => {
    const confirm = vi.fn(() => true)

    expect(confirmDestructiveAction('Delete folder?', 'This deletes children too.', confirm)).toBe(
      true,
    )
    expect(confirm).toHaveBeenCalledWith('Delete folder?\n\nThis deletes children too.')
  })

  it('returns false when the user cancels', () => {
    expect(confirmDestructiveAction('Delete item?', undefined, () => false)).toBe(false)
  })
})
