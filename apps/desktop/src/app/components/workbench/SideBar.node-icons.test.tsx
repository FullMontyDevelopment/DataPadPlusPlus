import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExplorerNodeIcon } from './SideBar.node-icons'

describe('ExplorerNodeIcon', () => {
  it('uses distinct closed and open folder glyphs', () => {
    const { container, rerender } = render(<ExplorerNodeIcon kind="folder" />)
    const closedPath = container.querySelector('path')?.getAttribute('d')

    rerender(<ExplorerNodeIcon expanded kind="folder" />)
    const openPath = container.querySelector('path')?.getAttribute('d')

    expect(container.querySelector('svg')).toHaveClass('tree-kind-icon--folder')
    expect(openPath).toBeTruthy()
    expect(openPath).not.toBe(closedPath)
  })
})
