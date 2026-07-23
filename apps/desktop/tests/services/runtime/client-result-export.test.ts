import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientResultExport } from '../../../src/services/runtime/client-result-export'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('client result export', () => {
  afterEach(() => {
    invoke.mockReset()
    delete window.__TAURI_INTERNALS__
  })

  it('uses the desktop save dialog command for result exports', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValue({ saved: true, path: 'C:/tmp/result.csv' })

    await expect(
      clientResultExport.exportResultFile({
        suggestedFileName: 'query-result',
        extension: 'csv',
        mimeType: 'text/csv;charset=utf-8',
        contents: 'a,b\n1,2',
      }),
    ).resolves.toEqual({ saved: true, path: 'C:/tmp/result.csv' })

    expect(invoke).toHaveBeenCalledWith('export_result_file', {
      request: {
        suggestedFileName: 'query-result',
        extension: 'csv',
        mimeType: 'text/csv;charset=utf-8',
        contents: 'a,b\n1,2',
      },
    })
  })

  it('passes canonical result references without formatting contents for desktop export', async () => {
    window.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValue({ saved: true, path: 'C:/tmp/result.json' })
    const request = {
      suggestedFileName: 'mongodb-document-result',
      extension: 'json',
      mimeType: 'application/json;charset=utf-8',
      resultReference: {
        tabId: 'tab-mongodb',
        resultId: 'result-mongodb',
        renderer: 'document' as const,
        format: 'json' as const,
      },
    }

    await expect(clientResultExport.exportResultFile(request)).resolves.toEqual({
      saved: true,
      path: 'C:/tmp/result.json',
    })
    expect(invoke).toHaveBeenCalledWith('export_result_file', { request })
  })

  it('rejects unsupported result export formats', async () => {
    await expect(
      clientResultExport.exportResultFile({
        suggestedFileName: 'query-result',
        extension: 'exe',
        mimeType: 'application/octet-stream',
        contents: 'nope',
      }),
    ).rejects.toThrow('Choose a supported result export format.')
  })
})
