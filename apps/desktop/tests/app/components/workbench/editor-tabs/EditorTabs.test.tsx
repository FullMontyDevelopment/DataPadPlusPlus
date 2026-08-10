import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { EditorTabs } from '../../../../../src/app/components/workbench/EditorTabs'

describe('EditorTabs environment accents', () => {
  it('keeps colors attached to environment identity across selection, reorder, and updates', () => {
    const { rerender } = renderEditorTabs({
      tabs: [tabOne, tabTwo],
      activeTabId: tabOne.id,
      environments,
    })

    expectTabEnvironment('Query 1', 'env-one', '#ef4444', true)
    expectTabEnvironment('Query 2', 'env-two', '#22c55e', false)

    rerender(
      <EditorTabs
        {...defaultEditorTabsProps}
        tabs={[tabTwo, tabOne]}
        activeTabId={tabTwo.id}
        environments={[
          { ...environmentTwo, color: '#0ea5e9' },
          { ...environmentOne, color: '#f97316' },
        ]}
      />,
    )

    expectTabEnvironment('Query 1', 'env-one', '#f97316', false)
    expectTabEnvironment('Query 2', 'env-two', '#0ea5e9', true)

    rerender(
      <EditorTabs
        {...defaultEditorTabsProps}
        tabs={[{ ...tabOne, environmentId: 'env-two' }, tabTwo]}
        activeTabId={tabOne.id}
        environments={environments}
      />,
    )

    expectTabEnvironment('Query 1', 'env-two', '#22c55e', true)
  })

  it('does not apply a fallback or another tab color when an environment is missing', () => {
    renderEditorTabs({
      tabs: [tabOne, tabTwo],
      activeTabId: tabTwo.id,
      environments: [environmentOne],
    })

    expectTabEnvironment('Query 1', 'env-one', '#ef4444', false)
    const unresolvedTab = screen.getByRole('tab', { name: /Query 2/ })
    expect(unresolvedTab).toHaveClass('is-active')
    expect(unresolvedTab).not.toHaveClass('has-environment-color')
    expect(unresolvedTab.style.getPropertyValue('--tab-env-color')).toBe('')
    expect(unresolvedTab).not.toHaveAttribute('data-environment-id')
  })
})

function renderEditorTabs(
  overrides: Partial<Parameters<typeof EditorTabs>[0]> = {},
) {
  return render(<EditorTabs {...defaultEditorTabsProps} {...overrides} />)
}

function expectTabEnvironment(
  title: string,
  environmentId: string,
  color: string,
  active: boolean,
) {
  const renderedTab = screen.getByRole('tab', { name: new RegExp(title) })
  expect(renderedTab).toHaveAttribute('data-environment-id', environmentId)
  expect(renderedTab).toHaveClass('has-environment-color')
  if (active) {
    expect(renderedTab).toHaveClass('is-active')
  } else {
    expect(renderedTab).not.toHaveClass('is-active')
  }
  expect(renderedTab.style.getPropertyValue('--tab-env-color')).toBe(color)
}

const tabOne: QueryTabState = {
  id: 'tab-one',
  title: 'Query 1.sql',
  connectionId: 'conn-one',
  environmentId: 'env-one',
  family: 'sql',
  language: 'sql',
  editorLabel: 'SQL editor',
  queryText: 'select 1;',
  status: 'idle',
  dirty: false,
  history: [],
}

const tabTwo: QueryTabState = {
  ...tabOne,
  id: 'tab-two',
  title: 'Query 2.sql',
  connectionId: 'conn-two',
  environmentId: 'env-two',
  queryText: 'select 2;',
}

const environmentOne: EnvironmentProfile = {
  id: 'env-one',
  label: 'Development',
  color: '#ef4444',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: true,
  exportable: true,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
}

const environmentTwo: EnvironmentProfile = {
  ...environmentOne,
  id: 'env-two',
  label: 'Production',
  color: '#22c55e',
  risk: 'high',
}

const environments = [environmentOne, environmentTwo]

const connectionOne: ConnectionProfile = {
  id: 'conn-one',
  name: 'Primary SQL',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'app',
  environmentIds: ['env-one'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'PG',
  auth: {},
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
}

const connectionTwo: ConnectionProfile = {
  ...connectionOne,
  id: 'conn-two',
  name: 'Secondary SQL',
  environmentIds: ['env-two'],
}

const defaultEditorTabsProps: Parameters<typeof EditorTabs>[0] = {
  tabs: [],
  activeTabId: '',
  connections: [connectionOne, connectionTwo],
  environments: [],
  onSelectTab: vi.fn(),
  onCloseTab: vi.fn(),
  onRenameTab: vi.fn(),
  onSaveTab: vi.fn(),
  onReorderTabs: vi.fn(),
  onCloseTabs: vi.fn(),
}
