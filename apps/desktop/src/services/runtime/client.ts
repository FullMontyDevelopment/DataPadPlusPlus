import { clientAdapters } from './client-adapters'
import { clientConnections } from './client-connections'
import { clientExecution } from './client-execution'
import { clientLibrary } from './client-library'
import { clientSavedWork } from './client-saved-work'
import { clientTabs } from './client-tabs'
import { clientTests } from './client-tests'
import { clientWorkspace } from './client-workspace'

export const desktopClient = {
  ...clientWorkspace,
  ...clientConnections,
  ...clientTabs,
  ...clientLibrary,
  ...clientSavedWork,
  ...clientAdapters,
  ...clientExecution,
  ...clientTests,
}
