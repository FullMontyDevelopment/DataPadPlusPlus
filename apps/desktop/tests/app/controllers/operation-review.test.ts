import { describe, expect, it } from 'vitest'
import type { OperationPlan } from '@datapadplusplus/shared-types'
import {
  operationReviewReasons,
  uniqueStrings,
} from '../../../src/app/controllers/operation-review'

describe('operation review controller', () => {
  it('preserves reason ordering while removing duplicate and confirmation-only warnings', () => {
    const plan = {
      operationId: 'mongodb.collection.drop',
      engine: 'mongodb',
      summary: 'Drop collection',
      generatedRequest: '{}',
      requestLanguage: 'json',
      destructive: true,
      confirmationText: 'DROP audit_log',
      estimatedCost: 'No cloud cost estimate.',
      estimatedScanImpact: 'Collection metadata scan.',
      requiredPermissions: ['dropCollection'],
      warnings: [
        'Review the target first.',
        'Type `DROP audit_log` to continue.',
        'Review the target first.',
      ],
    } satisfies OperationPlan

    expect(operationReviewReasons(plan)).toEqual([
      'Review the target first.',
      'This operation can make destructive changes.',
      'Collection metadata scan.',
      'No cloud cost estimate.',
    ])
  })

  it('deduplicates strings without changing their first-seen order', () => {
    expect(uniqueStrings(['two', 'one', 'two', 'three', 'one'])).toEqual([
      'two',
      'one',
      'three',
    ])
  })
})
