import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenuSurface } from '../../../../src/app/components/workbench/ContextMenuSurface'
import { calculateContextMenuPlacement } from '../../../../src/app/components/workbench/context-menu-placement'

describe('ContextMenuSurface', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clamps every edge while retaining an eight-pixel viewport margin', () => {
    const viewport = { height: 600, left: 0, top: 0, width: 800 }

    expect(
      calculateContextMenuPlacement(
        { x: 790, y: 590 },
        { height: 300, width: 240 },
        viewport,
      ),
    ).toEqual({ left: 552, maxHeight: 584, maxWidth: 784, top: 292 })

    expect(
      calculateContextMenuPlacement(
        { x: 1, y: 2 },
        { height: 100, width: 120 },
        viewport,
      ),
    ).toEqual({ left: 8, maxHeight: 584, maxWidth: 784, top: 8 })
  })

  it('constrains a menu larger than an offset visual viewport', () => {
    expect(
      calculateContextMenuPlacement(
        { x: 900, y: 700 },
        { height: 900, width: 1_000 },
        { height: 500, left: 100, top: 50, width: 700 },
      ),
    ).toEqual({ left: 108, maxHeight: 484, maxWidth: 684, top: 58 })
  })

  it('renders through the document body and positions the measured menu in view', () => {
    setViewport(800, 600)
    mockMenuBounds(240, 300)

    const host = document.createElement('div')
    host.style.overflow = 'hidden'
    document.body.append(host)

    const { unmount } = render(
      <ContextMenuSurface
        anchorPoint={{ x: 790, y: 590 }}
        ariaLabel="Viewport menu"
        className="connection-context-menu"
        onClose={vi.fn()}
      >
        <button type="button" role="menuitem">First action</button>
      </ContextMenuSurface>,
      { container: host },
    )

    const menu = screen.getByRole('menu', { name: 'Viewport menu' })
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveStyle({ left: '552px', top: '292px', visibility: 'visible' })
    expect(menu.style.getPropertyValue('--context-menu-max-height')).toBe('584px')
    expect(menu.style.getPropertyValue('--context-menu-max-width')).toBe('784px')

    unmount()
    host.remove()
  })

  it('focuses enabled actions and supports menu keyboard navigation', () => {
    setViewport(800, 600)
    mockMenuBounds(240, 200)

    render(
      <ContextMenuSurface
        anchorPoint={{ x: 40, y: 40 }}
        ariaLabel="Keyboard menu"
        className="connection-context-menu"
        onClose={vi.fn()}
      >
        <button type="button" role="menuitem">First</button>
        <button type="button" role="menuitem" disabled>Unavailable</button>
        <button type="button" role="menuitem">Last</button>
      </ContextMenuSurface>,
    )

    const menu = screen.getByRole('menu', { name: 'Keyboard menu' })
    const first = screen.getByRole('menuitem', { name: 'First' })
    const last = screen.getByRole('menuitem', { name: 'Last' })

    expect(first).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(last).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(last).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(last).toHaveFocus()
  })

  it('restores focus to the origin when Escape dismisses the menu', () => {
    setViewport(800, 600)
    mockMenuBounds(240, 200)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const origin = document.createElement('button')
    origin.textContent = 'Origin'
    document.body.append(origin)
    const onClose = vi.fn()

    render(
      <ContextMenuSurface
        anchorPoint={{ x: 40, y: 40 }}
        ariaLabel="Dismissable menu"
        className="connection-context-menu"
        onClose={onClose}
        originElement={origin}
      >
        <button type="button" role="menuitem">Action</button>
      </ContextMenuSurface>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
    expect(origin).toHaveFocus()
    origin.remove()
  })

  it('shows scroll affordances as the user moves through an oversized menu', () => {
    setViewport(320, 220)
    mockMenuBounds(220, 204)

    render(
      <ContextMenuSurface
        anchorPoint={{ x: 20, y: 20 }}
        ariaLabel="Scrollable menu"
        className="connection-context-menu"
        onClose={vi.fn()}
      >
        {Array.from({ length: 20 }, (_, index) => (
          <button key={index} type="button" role="menuitem">
            {`Action ${index + 1}`}
          </button>
        ))}
      </ContextMenuSurface>,
    )

    const menu = screen.getByRole('menu', { name: 'Scrollable menu' })
    Object.defineProperties(menu, {
      clientHeight: { configurable: true, value: 204 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, value: 0, writable: true },
    })

    fireEvent.scroll(menu)
    expect(menu).not.toHaveClass('has-scroll-above')
    expect(menu).toHaveClass('has-scroll-below')

    menu.scrollTop = 200
    fireEvent.scroll(menu)
    expect(menu).toHaveClass('has-scroll-above')
    expect(menu).toHaveClass('has-scroll-below')

    menu.scrollTop = 396
    fireEvent.scroll(menu)
    expect(menu).toHaveClass('has-scroll-above')
    expect(menu).not.toHaveClass('has-scroll-below')
  })

  it('dismisses on an outside pointer interaction', () => {
    setViewport(800, 600)
    mockMenuBounds(240, 200)
    const onClose = vi.fn()

    render(
      <ContextMenuSurface
        anchorPoint={{ x: 40, y: 40 }}
        ariaLabel="Outside menu"
        className="connection-context-menu"
        onClose={onClose}
      >
        <button type="button" role="menuitem">Action</button>
      </ContextMenuSurface>,
    )

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function mockMenuBounds(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function getBoundingClientRect() {
      const isMenu = this.getAttribute('role') === 'menu'
      return {
        bottom: isMenu ? height : 0,
        height: isMenu ? height : 0,
        left: 0,
        right: isMenu ? width : 0,
        toJSON: () => ({}),
        top: 0,
        width: isMenu ? width : 0,
        x: 0,
        y: 0,
      }
    },
  )
}
