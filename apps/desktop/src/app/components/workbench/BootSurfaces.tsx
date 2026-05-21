import { AppLogo } from './AppLogo'

export function BootSurface({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="boot-surface" role="status" aria-live="polite">
      <div className="boot-dialog">
        <AppLogo className="boot-logo" kind="transparent" />
        <h1>{title}</h1>
        <p>{copy}</p>
        <div className="boot-progress" aria-hidden="true" />
      </div>
    </div>
  )
}

export function WelcomeSurface({
  onCreateConnection,
  onImportWorkspace,
  onOpenDiagnostics,
}: {
  onCreateConnection(): void
  onImportWorkspace(): void
  onOpenDiagnostics(): void
}) {
  return (
    <section className="welcome-surface" aria-label="First run onboarding">
      <div className="welcome-panel">
        <AppLogo className="welcome-logo" />
        <h1>Connect to your first datastore.</h1>
        <p>
          Start with a real connection. DataPad++ will keep credentials in the
          desktop secret store and keep this workspace local to your machine.
        </p>
        <div className="welcome-actions">
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            onClick={onCreateConnection}
          >
            New Connection
          </button>
          <button type="button" className="drawer-button" onClick={onImportWorkspace}>
            Import Workspace
          </button>
          <button type="button" className="drawer-button" onClick={onOpenDiagnostics}>
            Open Settings
          </button>
        </div>
      </div>
    </section>
  )
}
