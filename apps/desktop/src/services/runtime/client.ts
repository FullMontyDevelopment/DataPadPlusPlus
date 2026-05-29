import { clientAdapters } from './client-adapters'
import { clientConnections } from './client-connections'
import { clientExecution } from './client-execution'
import { clientLibrary } from './client-library'
import { clientResultExport } from './client-result-export'
import { clientSavedWork } from './client-saved-work'
import { clientSettingsTab } from './client-settings-tab'
import { clientTabs } from './client-tabs'
import { clientTests } from './client-tests'
import { clientWorkspace } from './client-workspace'

export const desktopClient = {
  ...clientWorkspace,
  ...clientConnections,
  ...clientTabs,
  ...clientLibrary,
  ...clientResultExport,
  ...clientSavedWork,
  ...clientSettingsTab,
  ...clientAdapters,
  ...clientExecution,
  ...clientTests,
}
