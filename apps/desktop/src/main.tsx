import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import {
  installFrontendDiagnostics,
  reportFrontendDiagnostic,
} from './services/runtime/frontend-diagnostics'
import './styles/index.css'

installFrontendDiagnostics()
const rootElement = document.getElementById('root')
if (!rootElement) {
  void reportFrontendDiagnostic('renderer-root-missing', {
    level: 'error',
    message: 'The React root element was not present in the desktop document.',
  })
  throw new Error('DataPad++ could not find its React root element.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
void reportFrontendDiagnostic('renderer-render-dispatched', {
  message: 'React root rendering was dispatched.',
})
