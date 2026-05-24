import type {
  ConnectionProfile,
  DiagnosticsReport,
  EnvironmentProfile,
  ExplorerInspectResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { InspectionPayloadSummary } from '../InspectionPayloadSummary'

interface DetailsViewProps {
  activeConnection: ConnectionProfile
  activeEnvironment: EnvironmentProfile
  activeTab: QueryTabState
  diagnostics?: DiagnosticsReport
  explorerInspection?: ExplorerInspectResponse
  onApplyInspectionTemplate(queryTemplate?: string): void
}

export function DetailsView({
  activeConnection,
  activeEnvironment,
  activeTab,
  diagnostics,
  explorerInspection,
  onApplyInspectionTemplate,
}: DetailsViewProps) {
  const canApplyInspectionTemplate = Boolean(
    explorerInspection?.queryTemplate && activeTab.tabKind !== 'explorer',
  )

  return (
    <div className="panel-body-frame">
      <div className="panel-title-row">
        <div>
          <strong>Details</strong>
        </div>
      </div>

      <div className="details-grid">
        <DetailRow label="Connection" value={activeConnection.name} />
        <DetailRow label="Environment" value={activeEnvironment.label} />
        <DetailRow label="Database" value={activeConnection.database ?? 'n/a'} />
        <DetailRow label="Editor" value={activeTab.editorLabel} />
        <DetailRow label="Last Run" value={activeTab.lastRunAt ?? 'Never'} />
        <DetailRow label="Runtime" value={diagnostics?.runtime ?? 'desktop'} />
      </div>

      <div className="details-section">
        <strong>Guardrails</strong>
        <ul className="messages-list">
          {(activeTab.result?.notices.map((notice) => notice.message) ?? [
            'Guardrail decisions will appear after query execution.',
          ]).map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </div>

      <div className="details-section">
        <div className="details-section-header">
          <strong>Inspection</strong>
          {explorerInspection?.queryTemplate ? (
            <button
              type="button"
              className="drawer-link-button"
              disabled={!canApplyInspectionTemplate}
              title={
                canApplyInspectionTemplate
                  ? 'Apply this starter query to the active query tab.'
                  : 'Open a query tab before applying this starter query.'
              }
              onClick={() => onApplyInspectionTemplate(explorerInspection.queryTemplate)}
            >
              Apply starter query
            </button>
          ) : null}
        </div>
        <p>{explorerInspection?.summary ?? 'No object selected.'}</p>
        {explorerInspection?.queryTemplate ? (
          <p className="panel-footnote">
            A starter query is available for this object. Apply it to the active query tab to
            review or run.
          </p>
        ) : null}
        {explorerInspection?.payload ? (
          <InspectionPayloadSummary payload={explorerInspection.payload} />
        ) : null}
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
