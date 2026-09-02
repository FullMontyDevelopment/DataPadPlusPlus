import { datastoreTransferManifest } from '../../../desktop/src/services/runtime/datastore-transfer-manifests'
import type { DatastoreEngineId } from './datastores'

const supportLabel = {
  live: 'Live',
  'plan-only': 'Plan only',
  unsupported: 'Unavailable',
} as const

const actionLabel = {
  import: 'Import',
  export: 'Export',
  backup: 'Backup',
  restore: 'Restore',
} as const

function sentence(value: string) {
  return /[.!?]$/.test(value) ? value : `${value}.`
}

export function transferDocumentation(engine: DatastoreEngineId) {
  return datastoreTransferManifest(engine).capabilities.map((capability) => {
    const formats = capability.formats.length
      ? ` Formats: ${capability.formats.map((format) => `${format.label} (${format.fidelity})`).join(', ')}.`
      : ''
    const destinations = capability.destinationKinds.length
      ? ` Destinations: ${capability.destinationKinds.map((destination) => destination.replaceAll('-', ' ')).join(', ')}.`
      : ''
    const boundary = capability.disabledReason ? ` ${sentence(capability.disabledReason)}` : ''

    return `${actionLabel[capability.action]} — ${supportLabel[capability.executionSupport]}. ${sentence(capability.description)}${formats}${destinations}${boundary}`
  })
}

export function transferSupportMatrix(engine: DatastoreEngineId) {
  return Object.fromEntries(
    datastoreTransferManifest(engine).capabilities.map((capability) => [
      capability.action,
      capability.executionSupport,
    ]),
  )
}
