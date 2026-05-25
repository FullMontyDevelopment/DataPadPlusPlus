import type {
  BootstrapPayload,
  CancelTestRunRequest,
  CreateTestSuiteTabRequest,
  ExecuteTestSuiteRequest,
  ExecuteTestSuiteResponse,
  OpenTestSuiteTemplateRequest,
  UpdateTestSuiteTabRequest,
} from '@datapadplusplus/shared-types'
import {
  cancelTestRunLocally,
  createTestSuiteTabInSnapshot,
  executeTestSuiteLocally,
  openTestSuiteTemplateInSnapshot,
  updateTestSuiteTabInSnapshot,
} from './browser-tests'
import {
  buildBrowserPayload,
  loadBrowserSnapshot,
  saveBrowserSnapshot,
} from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import {
  validateCancelTestRunRequest,
  validateCreateTestSuiteTabRequest,
  validateExecuteTestSuiteRequest,
  validateOpenTestSuiteTemplateRequest,
  validateUpdateTestSuiteTabRequest,
} from './request-validation'

export const clientTests = {
  async createTestSuiteTab(request: CreateTestSuiteTabRequest): Promise<BootstrapPayload> {
    request = validateCreateTestSuiteTabRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_test_suite_tab', { request })
    }

    const snapshot = createTestSuiteTabInSnapshot(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async openTestSuiteTemplate(
    request: OpenTestSuiteTemplateRequest,
  ): Promise<BootstrapPayload> {
    request = validateOpenTestSuiteTemplateRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('open_test_suite_template', { request })
    }

    const snapshot = openTestSuiteTemplateInSnapshot(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async updateTestSuiteTab(request: UpdateTestSuiteTabRequest): Promise<BootstrapPayload> {
    request = validateUpdateTestSuiteTabRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_test_suite_tab', { request })
    }

    const snapshot = updateTestSuiteTabInSnapshot(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async executeTestSuite(request: ExecuteTestSuiteRequest): Promise<ExecuteTestSuiteResponse> {
    request = validateExecuteTestSuiteRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<ExecuteTestSuiteResponse>('execute_test_suite', { request })
    }

    const { snapshot, response } = executeTestSuiteLocally(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return response
  },

  async cancelTestRun(
    request: CancelTestRunRequest,
  ): Promise<{ ok: boolean; supported: boolean; message: string }> {
    request = validateCancelTestRunRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop('cancel_test_run', { request })
    }

    const { snapshot, ...response } = cancelTestRunLocally(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return response
  },
}
