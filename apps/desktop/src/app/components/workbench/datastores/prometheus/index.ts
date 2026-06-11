import type { DatastoreWorkbenchSlice } from '../types'
import { PrometheusObjectViewWorkspace } from './PrometheusObjectViewWorkspace'

export const prometheusWorkbenchSlice = {
  engine: 'prometheus',
  objectViewWorkspace: PrometheusObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
