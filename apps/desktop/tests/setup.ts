import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Unit tests supply editor doubles; browser/build tests exercise bundled workers.
vi.mock('../src/app/components/workbench/monaco-runtime', () => import('@monaco-editor/react'))

afterEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  cleanup()
})
