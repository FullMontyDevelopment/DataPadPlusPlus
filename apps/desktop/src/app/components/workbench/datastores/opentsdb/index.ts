import type { DatastoreWorkbenchSlice } from '../types'
import { OpenTsdbObjectViewWorkspace } from './OpenTsdbObjectViewWorkspace'

export const opentsdbWorkbenchSlice = {
  engine: 'opentsdb',
  objectViewWorkspace: OpenTsdbObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
