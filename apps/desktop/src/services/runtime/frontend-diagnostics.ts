import { invokeDesktop, isTauriRuntime } from './desktop-bridge'

export type FrontendDiagnosticLevel = 'info' | 'warning' | 'error'

export interface FrontendDiagnosticOptions {
  context?: Record<string, string | number | boolean | null | undefined>
  level?: FrontendDiagnosticLevel
  message?: string
  stack?: string
}

export interface DescribedFrontendError {
  message: string
  stack?: string
}

const rendererSessionId = createFrontendCorrelationId('renderer')
let diagnosticSequence = 0
let diagnosticsInstalled = false

export function createFrontendCorrelationId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${randomId}`
}

export function describeUnknownError(value: unknown): DescribedFrontendError {
  if (value instanceof Error) {
    return {
      message: value.message || value.name || 'Unknown Error',
      stack: value.stack,
    }
  }
  if (typeof value === 'string') {
    return { message: value }
  }
  try {
    const serialized = JSON.stringify(value)
    return { message: serialized || String(value) }
  } catch {
    return { message: String(value) }
  }
}

export function reportFrontendDiagnostic(
  event: string,
  options: FrontendDiagnosticOptions = {},
) {
  if (!isTauriRuntime()) {
    return Promise.resolve()
  }

  diagnosticSequence += 1
  const context = Object.fromEntries(
    Object.entries(options.context ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )

  return invokeDesktop<void>('record_frontend_diagnostic', {
    request: {
      event,
      level: options.level ?? 'info',
      message: options.message,
      stack: options.stack,
      sessionId: rendererSessionId,
      sequence: diagnosticSequence,
      context,
    },
  }).catch(() => {
    // Diagnostics must never introduce a second renderer failure.
  })
}

export function installFrontendDiagnostics() {
  if (diagnosticsInstalled || typeof window === 'undefined') {
    return () => undefined
  }
  diagnosticsInstalled = true

  const onError = (event: Event) => {
    if (event instanceof ErrorEvent) {
      const error = describeUnknownError(event.error ?? event.message)
      void reportFrontendDiagnostic('window-error', {
        level: 'error',
        message: error.message,
        stack: error.stack,
        context: {
          column: event.colno,
          file: event.filename,
          line: event.lineno,
        },
      })
      return
    }

    const target = event.target
    void reportFrontendDiagnostic('resource-load-error', {
      level: 'error',
      message: 'A renderer resource failed to load.',
      context: {
        element: target instanceof Element ? target.tagName.toLowerCase() : 'unknown',
        source: resourceSource(target),
      },
    })
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = describeUnknownError(event.reason)
    void reportFrontendDiagnostic('unhandled-rejection', {
      level: 'error',
      message: error.message,
      stack: error.stack,
    })
  }
  const onSecurityPolicyViolation = (event: SecurityPolicyViolationEvent) => {
    void reportFrontendDiagnostic('security-policy-violation', {
      level: 'error',
      message: event.violatedDirective || 'Content security policy violation.',
      context: {
        blockedUri: event.blockedURI,
        disposition: event.disposition,
        documentUri: event.documentURI,
      },
    })
  }
  const onPageHide = (event: PageTransitionEvent) => {
    void reportFrontendDiagnostic('renderer-page-hide', {
      context: { persisted: event.persisted },
      message: 'The renderer page is being hidden.',
    })
  }
  const onVisibilityChange = () => {
    void reportFrontendDiagnostic('renderer-visibility-change', {
      context: { visibility: document.visibilityState },
      message: `Renderer visibility changed to ${document.visibilityState}.`,
    })
  }

  window.addEventListener('error', onError, true)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  window.addEventListener('securitypolicyviolation', onSecurityPolicyViolation)
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)

  void reportFrontendDiagnostic('renderer-bootstrap-start', {
    message: 'Frontend diagnostics installed before the React root was rendered.',
    context: {
      path: window.location.pathname,
      userAgent: window.navigator.userAgent,
    },
  })

  return () => {
    diagnosticsInstalled = false
    window.removeEventListener('error', onError, true)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    window.removeEventListener('securitypolicyviolation', onSecurityPolicyViolation)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

function resourceSource(target: EventTarget | null) {
  if (target instanceof HTMLScriptElement) return target.src
  if (target instanceof HTMLLinkElement) return target.href
  if (target instanceof HTMLImageElement) return target.src
  return ''
}
