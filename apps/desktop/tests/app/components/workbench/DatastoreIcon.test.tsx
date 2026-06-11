import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DATASTORE_ENGINES } from '@datapadplusplus/shared-types'
import { DatastoreIcon } from '../../../../src/app/components/workbench/DatastoreIcon'

describe('DatastoreIcon', () => {
  it('renders custom SVG marks for every datastore engine', () => {
    for (const engine of DATASTORE_ENGINES) {
      const { container, unmount } = render(
        <DatastoreIcon decorative={false} engine={engine} />,
      )

      expect(screen.getByRole('img')).toHaveAccessibleName(/datastore icon/i)
      expect(container.querySelector('svg.datastore-icon-svg')).not.toBeNull()
      expect(container.querySelector('.datastore-icon')?.textContent).toBe('')

      unmount()
    }
  })

  it('uses brand icon paths where a recognizable datastore mark is available', () => {
    for (const engine of ['postgresql', 'mongodb', 'mysql', 'redis'] as const) {
      const { container, unmount } = render(<DatastoreIcon engine={engine} />)

      expect(container.querySelector('.datastore-icon--brand')).not.toBeNull()
      expect(container.querySelector('.datastore-icon-brand-path')).not.toBeNull()

      unmount()
    }
  })

  it('keeps styled fallbacks for engines without packaged brand marks', () => {
    const { container } = render(<DatastoreIcon engine="sqlserver" />)

    expect(container.querySelector('.datastore-icon--fallback')).not.toBeNull()
    expect(container.querySelector('.datastore-icon-brand-path')).toBeNull()
  })
})
