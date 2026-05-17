import { useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  LibraryNode,
} from '@datapadplusplus/shared-types'
import { datastoreTestTemplatesForEngine } from '@datapadplusplus/shared-types'
import { DatastoreIcon } from './DatastoreIcon'
import { PlusIcon, TestsIcon } from './icons'

interface TestsPaneProps {
  activeConnectionId: string
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  libraryNodes: LibraryNode[]
  onCreateTestSuite(connectionId?: string): void
  onOpenLibraryItem(nodeId: string): void
  onOpenTemplate(connectionId: string, templateId: string): void
}

export function TestsPane({
  activeConnectionId,
  connections,
  environments,
  libraryNodes,
  onCreateTestSuite,
  onOpenLibraryItem,
  onOpenTemplate,
}: TestsPaneProps) {
  const [filter, setFilter] = useState('')
  const testItems = useMemo(
    () =>
      libraryNodes
        .filter((node) => node.kind === 'test-suite')
        .filter((node) => node.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [filter, libraryNodes],
  )
  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ?? connections[0]

  return (
    <div className="sidebar-pane tests-pane">
      <header className="sidebar-header">
        <div>
          <p className="sidebar-eyebrow">Tests</p>
          <h1>Tests</h1>
        </div>
        <button
          type="button"
          className="sidebar-icon-button"
          aria-label="Create test suite"
          title="Create a test suite for the selected connection."
          onClick={() => onCreateTestSuite(activeConnection?.id)}
        >
          <PlusIcon className="sidebar-inline-icon" />
        </button>
      </header>

      <input
        className="sidebar-search"
        placeholder="Search test suites"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <section className="tests-pane-section">
        <div className="tests-pane-section-header">
          <span>Templates</span>
        </div>
        <div className="tests-template-list">
          {connections.map((connection) => {
            const templates = datastoreTestTemplatesForEngine(connection.engine, connection.family)
            const environment = environments.find(
              (item) => item.id === connection.environmentIds[0],
            )

            return templates.map((template) => (
              <button
                key={`${connection.id}-${template.id}`}
                type="button"
                className="tests-template-button"
                onClick={() => onOpenTemplate(connection.id, template.id)}
              >
                <DatastoreIcon
                  decorative
                  engine={connection.engine}
                  className="connection-row-icon"
                />
                <span>
                  <strong>{template.label}</strong>
                  <small>
                    {connection.name}
                    {environment ? ` / ${environment.label}` : ''}
                  </small>
                </span>
              </button>
            ))
          })}
        </div>
      </section>

      <section className="tests-pane-section">
        <div className="tests-pane-section-header">
          <span>Library Suites</span>
          <span>{testItems.length}</span>
        </div>
        <div className="tests-library-list">
          {testItems.length === 0 ? (
            <p className="sidebar-empty">No saved test suites yet.</p>
          ) : (
            testItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="tests-library-button"
                onClick={() => onOpenLibraryItem(item.id)}
              >
                <TestsIcon className="sidebar-inline-icon" />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.summary ?? 'Library test suite'}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
