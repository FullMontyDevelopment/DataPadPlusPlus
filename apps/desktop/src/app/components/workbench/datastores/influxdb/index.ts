import type { DatastoreWorkbenchSlice } from '../types'
import { InfluxObjectViewWorkspace } from './InfluxObjectViewWorkspace'

export const influxdbWorkbenchSlice = {
  engine: 'influxdb',
  objectViewWorkspace: InfluxObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
