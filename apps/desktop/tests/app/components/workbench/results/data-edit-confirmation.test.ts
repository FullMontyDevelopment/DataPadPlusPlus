import { describe, expect, it, vi } from 'vitest'
import type {
  DataEditExecutionRequest,
  DataEditExecutionResponse,
} from '@datapadplusplus/shared-types'
import {
  dataEditConfirmationDetails,
  dataEditStatusMessage,
  executeDataEditWithConfirmation,
} from '../../../../../src/app/components/workbench/results/data-edit-confirmation'

describe('data edit confirmation', () => {
  it('uses a confirm callback and retries with the runtime confirmation text', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => responseForRequest(request))
    const confirm = vi.fn(async () => true)
    const request = dataEditRequest()

    const response = await executeDataEditWithConfirmation(executeDataEdit, request, {
      confirm,
      actionLabel: 'Update document field.',
      confirmationTitle: 'Apply this edit?',
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(executeDataEdit).toHaveBeenCalledTimes(2)
    expect(executeDataEdit).toHaveBeenLastCalledWith({
      ...request,
      confirmationText: 'CONFIRM QA',
    })
    expect(response?.executed).toBe(true)
    expect(response?.warnings).not.toContain('Type `CONFIRM QA` before executing this data edit.')
  })

  it('cancels cleanly when the user rejects the confirmation dialog', async () => {
    const response = await executeDataEditWithConfirmation(
      async (request) => responseForRequest(request),
      dataEditRequest(),
      {
        confirm: async () => false,
      },
    )

    expect(response?.executed).toBe(false)
    expect(response?.warnings).toContain('Data edit canceled before execution.')
    expect(response?.warnings).not.toContain('Type `CONFIRM QA` before executing this data edit.')
  })

  it('removes typed-confirmation wording from dialog details and status messages', () => {
    const response = responseForRequest(dataEditRequest())

    expect(dataEditConfirmationDetails(response, {
      confirmationTitle: 'Apply this edit?',
      actionLabel: 'Update document field.',
    })).toEqual({
      title: 'Apply this edit?',
      action: 'Update document field.',
      reasons: [
        'QA requires confirmation for risky work.',
        'This data edit needs confirmation before it can run.',
      ],
    })
    expect(dataEditStatusMessage(response, 'fallback')).toBe('This data edit needs confirmation before it can run.')
  })

  it('returns a clear warning when confirmation UI is unavailable', async () => {
    const response = await executeDataEditWithConfirmation(
      async (request) => responseForRequest(request),
      dataEditRequest(),
    )

    expect(response?.warnings).toContain('Data edit canceled because confirmation UI is unavailable.')
    expect(response?.warnings).not.toContain('Type `CONFIRM QA` before executing this data edit.')
  })

  it('does not open confirmation for safe-mode blocked responses', async () => {
    const confirm = vi.fn(async () => true)
    const response = await executeDataEditWithConfirmation(
      async () => safeModeBlockedResponse(),
      dataEditRequest(),
      { confirm },
    )

    expect(confirm).not.toHaveBeenCalled()
    expect(response?.executed).toBe(false)
    expect(response?.warnings).toContain('Global safe mode blocks inline result edits.')
  })

  it('propagates runtime failures to the active result view', async () => {
    const failure = new Error('MongoDB permission denied')

    await expect(executeDataEditWithConfirmation(
      async () => {
        throw failure
      },
      dataEditRequest(),
    )).rejects.toBe(failure)
  })
})

function dataEditRequest(): DataEditExecutionRequest {
  return {
    connectionId: 'conn-mongo',
    environmentId: 'env-qa',
    editKind: 'set-field',
    target: {
      objectKind: 'document',
      path: [],
      collection: 'products',
      documentId: 'product-1',
    },
    changes: [
      {
        path: ['status'],
        value: 'active',
        valueType: 'string',
      },
    ],
  }
}

function responseForRequest(request: DataEditExecutionRequest): DataEditExecutionResponse {
  const confirmed = request.confirmationText === 'CONFIRM QA'

  return {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    editKind: request.editKind,
    executionSupport: 'live',
    executed: confirmed,
    plan: {
      operationId: 'mongodb.data-edit.set-field',
      engine: 'mongodb',
      summary: 'Updated document field.',
      generatedRequest: '{}',
      requestLanguage: 'mongodb',
      destructive: false,
      requiredPermissions: ['update collection document'],
      confirmationText: 'CONFIRM QA',
      warnings: [
        'Type `CONFIRM QA` before executing this data edit.',
        'QA requires confirmation for risky work.',
      ],
    },
    messages: confirmed
      ? ['Updated document field.']
      : ['Type `CONFIRM QA` before executing this data edit.'],
    warnings: confirmed
      ? []
      : [
          'Type `CONFIRM QA` before executing this data edit.',
          'This data edit needs confirmation before it can run.',
        ],
  }
}

function safeModeBlockedResponse(): DataEditExecutionResponse {
  return {
    connectionId: 'conn-mongo',
    environmentId: 'env-qa',
    editKind: 'set-field',
    executionSupport: 'live',
    executed: false,
    plan: {
      operationId: 'mongodb.data-edit.set-field',
      engine: 'mongodb',
      summary: 'Updated document field.',
      generatedRequest: '{}',
      requestLanguage: 'mongodb',
      destructive: false,
      requiredPermissions: ['update collection document'],
      warnings: ['Global safe mode blocks inline result edits.'],
    },
    messages: [],
    warnings: ['Global safe mode blocks inline result edits.'],
  }
}
