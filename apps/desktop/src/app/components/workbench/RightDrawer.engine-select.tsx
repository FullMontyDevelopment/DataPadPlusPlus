import { useEffect, useRef, useState } from 'react'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { DatastoreIcon } from './DatastoreIcon'
import { ChevronDownIcon } from './icons'
import { engineOption, ENGINE_GROUPS } from './RightDrawer.helpers'

export function DatastoreEngineSelect({
  onChange,
  value,
}: {
  onChange(engine: ConnectionProfile['engine']): void
  value: ConnectionProfile['engine']
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedOption = engineOption(value)

  useEffect(() => {
    if (!open) {
      return
    }

    const close = () => setOpen(false)
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return
      }

      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div className="datastore-select" ref={rootRef}>
      <button
        type="button"
        className="datastore-select-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Database type"
        title="Choose the datastore engine for this connection profile."
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <DatastoreIcon engine={value} />
        <span className="datastore-select-label">
          <strong>{selectedOption?.label ?? value}</strong>
          <small>{selectedOption?.family ?? 'datastore'}</small>
        </span>
        <ChevronDownIcon className="datastore-select-chevron" />
      </button>

      {open ? (
        <div className="datastore-select-menu" role="listbox" aria-label="Datastore types">
          {ENGINE_GROUPS.map((group) => (
            <div className="datastore-select-group" key={group.label}>
              <div className="datastore-select-group-label">{group.label}</div>
              {group.options.map((option) => {
                const planned = option.maturity === 'planned'
                const selected = option.value === value

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-label={option.label}
                    aria-selected={selected}
                    className={`datastore-select-option${selected ? ' is-selected' : ''}`}
                    disabled={planned}
                    title={
                      planned
                        ? `${option.label} is coming soon and is not selectable yet.`
                        : `Use ${option.label} for this connection.`
                    }
                    onClick={() => {
                      if (planned) {
                        return
                      }

                      onChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <DatastoreIcon engine={option.value} />
                    <span className="datastore-select-option-text">
                      <strong>{option.label}</strong>
                      <small>
                        {option.family}
                        {planned ? ' / Coming soon' : ''}
                      </small>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
