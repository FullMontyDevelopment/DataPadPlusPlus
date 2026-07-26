import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  DatastoreTestSuiteDefinition,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { TestSuiteWorkspace } from '../../../../src/app/components/workbench/TestSuiteWorkspace'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'

describe('TestSuiteWorkspace', () => {
  it('preserves restored suites behind an enable-plugin placeholder', () => {
    const { tab, connection, environment } = fixture()
    const onEnablePlugin = vi.fn()

    render(
      <TestSuiteWorkspace
        tab={tab}
        connection={connection}
        environment={environment}
        enabled={false}
        executionStatus="idle"
        onEnablePlugin={onEnablePlugin}
        onRunSuite={vi.fn()}
        onCancelRun={vi.fn()}
        onUpdateSuite={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Datastore Tests is disabled' })).toBeVisible()
    expect(screen.queryByText(/raw json/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enable Datastore Tests' }))
    expect(onEnablePlugin).toHaveBeenCalledOnce()
  })

  it('renders suite-owned cases and selects a virtual case without opening another tab', () => {
    const { tab, connection, environment, suite } = fixture()
    const onUpdateSuite = vi.fn()

    render(
      <TestSuiteWorkspace
        tab={tab}
        connection={connection}
        environment={environment}
        enabled
        executionStatus="idle"
        onEnablePlugin={vi.fn()}
        onRunSuite={vi.fn()}
        onCancelRun={vi.fn()}
        onUpdateSuite={onUpdateSuite}
      />,
    )

    expect(screen.getByRole('button', { name: 'Open test case reads rows' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open test case writes rows' })).toBeVisible()
    expect(screen.queryByText(/immutable datastore binding/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suite Details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('Suite name')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Case name')).toBeVisible()
    expect(screen.getByLabelText('Case timeout (ms)')).toBeVisible()
    expect(screen.queryByRole('combobox', { name: /language/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /^target$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open test case writes rows' }))
    expect(onUpdateSuite).toHaveBeenCalledWith(suite, 'case-write')
  })

  it('opens suite metadata in a closable details panel', () => {
    const { tab, connection, environment } = fixture()
    const onUpdateSuite = vi.fn()

    render(
      <TestSuiteWorkspace
        tab={tab}
        connection={connection}
        environment={environment}
        enabled
        executionStatus="idle"
        onEnablePlugin={vi.fn()}
        onRunSuite={vi.fn()}
        onCancelRun={vi.fn()}
        onUpdateSuite={onUpdateSuite}
      />,
    )

    const detailsToggle = screen.getByRole('button', { name: 'Suite Details' })
    fireEvent.click(detailsToggle)

    expect(detailsToggle).toHaveAttribute('aria-expanded', 'true')
    const details = screen.getByLabelText('Suite details')
    expect(details).toBeVisible()
    expect(within(details).getByLabelText('Suite name')).toHaveValue('Orders contract')
    expect(within(details).getByLabelText('Description')).toHaveValue(
      'Validates order reads and writes.',
    )
    expect(within(details).getByLabelText('Datastore binding details')).toHaveTextContent(
      'Analytics Postgres',
    )
    expect(within(details).getByLabelText('Datastore binding details')).toHaveTextContent(
      'public / orders',
    )
    expect(within(details).getByLabelText('Datastore binding details')).toHaveTextContent(
      'sql',
    )
    expect(within(details).getByLabelText('Variable 1 name')).toHaveValue('TENANT_ID')

    fireEvent.change(within(details).getByLabelText('Suite name'), {
      target: { value: 'Updated contract' },
    })
    expect(onUpdateSuite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated contract' }),
      'case-read',
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('Suite details')).not.toBeInTheDocument()
    expect(detailsToggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(detailsToggle)
    fireEvent.click(screen.getByRole('button', { name: 'Close suite details' }))
    expect(screen.queryByLabelText('Suite details')).not.toBeInTheDocument()
  })

  it('removes steps and assertions while protecting the last case', () => {
    const { tab, connection, environment } = fixture({ singleCase: true })
    const onUpdateSuite = vi.fn()

    render(
      <TestSuiteWorkspace
        tab={tab}
        connection={connection}
        environment={environment}
        enabled
        executionStatus="idle"
        onEnablePlugin={vi.fn()}
        onRunSuite={vi.fn()}
        onCancelRun={vi.fn()}
        onUpdateSuite={onUpdateSuite}
      />,
    )

    expect(screen.getByRole('button', { name: 'Remove reads rows' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove step Seed fixture' }))
    expect(onUpdateSuite.mock.calls.at(-1)?.[0].cases[0].setup).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Remove assertion Has one row' }))
    expect(onUpdateSuite.mock.calls.at(-1)?.[0].cases[0].assertions).toHaveLength(0)
    expect(screen.queryByText(/raw test json/i)).not.toBeInTheDocument()
  })

  it('preserves a restored suite with no target behind a non-running recovery state', () => {
    const { tab, connection, environment, suite } = fixture()
    delete (suite as Partial<DatastoreTestSuiteDefinition>).scopedTarget
    tab.scopedTarget = undefined

    render(
      <TestSuiteWorkspace
        tab={tab}
        connection={connection}
        environment={environment}
        enabled
        executionStatus="idle"
        onEnablePlugin={vi.fn()}
        onRunSuite={vi.fn()}
        onCancelRun={vi.fn()}
        onUpdateSuite={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Test suite target required' })).toBeVisible()
    expect(screen.getByText(/suite has been preserved/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Run Suite' })).not.toBeInTheDocument()
  })
})

function fixture(options: { singleCase?: boolean } = {}) {
  const snapshot = createSeedSnapshot()
  const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')!
  const suite: DatastoreTestSuiteDefinition = {
    id: 'suite-orders',
    name: 'Orders contract',
    description: 'Validates order reads and writes.',
    engine: connection.engine,
    family: connection.family,
    connectionId: connection.id,
    environmentId: 'env-dev',
    scopedTarget: {
      kind: 'table',
      label: 'orders',
      path: ['public'],
      scope: 'table:public.orders',
    },
    inferredLanguage: 'sql',
    variables: { TENANT_ID: 'acme' },
    cases: [
      {
        id: 'case-read',
        name: 'reads rows',
        enabled: true,
        timeoutMs: 30000,
        setup: [
          {
            id: 'step-seed',
            label: 'Seed fixture',
            phase: 'setup',
            kind: 'query',
            enabled: true,
            language: 'sql',
            queryText: 'insert into orders(id) values (1);',
          },
        ],
        execute: [
          {
            id: 'step-read',
            label: 'Read fixture',
            phase: 'execute',
            kind: 'query',
            enabled: true,
            language: 'sql',
            queryText: 'select * from orders;',
          },
        ],
        assertions: [
          {
            id: 'assert-row',
            label: 'Has one row',
            kind: 'row-count',
            comparison: 'equals',
            expected: 1,
          },
        ],
        teardown: [],
      },
      {
        id: 'case-write',
        name: 'writes rows',
        enabled: true,
        setup: [],
        execute: [],
        assertions: [],
        teardown: [],
      },
    ],
  }
  if (options.singleCase) {
    suite.cases = [suite.cases[0]!]
  }
  const tab: QueryTabState = {
    id: 'tab-tests',
    title: 'Orders contract.datapad-test.json',
    tabKind: 'test-suite',
    connectionId: connection.id,
    environmentId: 'env-dev',
    family: connection.family,
    language: 'json',
    editorLabel: 'Orders tests',
    queryText: JSON.stringify(suite),
    scopedTarget: suite.scopedTarget,
    testSuite: suite,
    activeTestCaseId: 'case-read',
    status: 'idle',
    dirty: false,
    history: [],
  }
  const environment = snapshot.environments.find((item) => item.id === 'env-dev')!
  return { tab, connection, environment, suite }
}
