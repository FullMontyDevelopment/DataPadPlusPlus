import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { reportFrontendDiagnostic } from '../../services/runtime/frontend-diagnostics'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
  }

  public static getDerivedStateFromError() {
    return {
      hasError: true,
    }
  }

  public override componentDidCatch(error: Error, info: ErrorInfo) {
    void reportFrontendDiagnostic('react-error-boundary', {
      level: 'error',
      message: error.message,
      stack: error.stack,
      context: {
        componentStack: info.componentStack ?? '',
      },
    })
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="boot-screen">
          <div className="boot-card">
            <p className="workspace-label">Desktop recovery</p>
            <h1>DataPad++ hit an unexpected UI failure.</h1>
            <p className="workspace-copy">
              Reload the desktop shell to recover. Workspace persistence is designed
              to survive renderer crashes.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
