import type {
  ExecutionCapabilities,
  ExplorerInspectResponse,
} from '@datapadplusplus/shared-types'
import { ExplorerIcon } from './icons'
import { InspectionPayloadSummary } from './InspectionPayloadSummary'
import { DrawerHeader } from './RightDrawer.primitives'

export function InspectionBlade({
  capabilities,
  inspection,
  onApplyTemplate,
  onClose,
}: {
  capabilities: ExecutionCapabilities
  inspection?: ExplorerInspectResponse
  onApplyTemplate(queryTemplate?: string): void
  onClose(): void
}) {
  return (
    <>
      <DrawerHeader
        title="Object Details"
        subtitle="Selected object"
        icon={ExplorerIcon}
        onClose={onClose}
      />

      <div className="drawer-scroll">
        <div className="drawer-section">
          <div className="drawer-section-header">
            <strong>Inspection</strong>
            <button
              type="button"
              className="drawer-link-button"
              disabled={!inspection?.queryTemplate}
              onClick={() => onApplyTemplate(inspection?.queryTemplate)}
            >
              Apply starter query
            </button>
          </div>

          <p className="drawer-copy">
            {inspection?.summary ?? 'No object selected.'}
          </p>

          {inspection?.queryTemplate ? (
            <p className="drawer-copy">
              A starter query is available for this object. Apply it to review the query in an
              editor.
            </p>
          ) : null}

          {inspection?.payload ? (
            <InspectionPayloadSummary drawer payload={inspection.payload} />
          ) : null}
        </div>

        <div className="drawer-section">
          <div className="drawer-section-header">
            <strong>Available actions</strong>
            <span>connection</span>
          </div>
          <div className="drawer-pill-row">
            <span className="drawer-pill">
              Live metadata {availabilityLabel(capabilities.supportsLiveMetadata)}
            </span>
            <span className="drawer-pill">
              Cancel running work {availabilityLabel(capabilities.canCancel)}
            </span>
            <span className="drawer-pill">
              Explain plans {availabilityLabel(capabilities.canExplain)}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

function availabilityLabel(available: boolean) {
  return available ? 'available' : 'unavailable'
}
