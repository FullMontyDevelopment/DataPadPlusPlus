import { strict as assert } from 'node:assert'

async function applicationWindows() {
  const currentHandle = await browser.getWindowHandle()
  const handles = await browser.getWindowHandles()
  const windows = []

  for (const handle of handles) {
    await browser.switchToWindow(handle)
    windows.push({
      handle,
      title: await browser.getTitle(),
      url: await browser.getUrl(),
    })
  }

  await browser.switchToWindow(currentHandle)
  return windows
}

async function selectApplicationWindow() {
  const windows = await applicationWindows()
  const applicationWindow = windows.find(
    (window) => window.url !== 'about:blank' || window.title.length > 0,
  )

  if (applicationWindow) {
    await browser.switchToWindow(applicationWindow.handle)
  }
}

async function appText() {
  await selectApplicationWindow()
  return browser.execute(() => document.body.innerText)
}

async function appBootstrapDiagnostics() {
  const windows = await applicationWindows()
  const documentState = await browser.execute(() => ({
    url: window.location.href,
    readyState: document.readyState,
    title: document.title,
    rootHtml: document.querySelector('#root')?.innerHTML.slice(0, 2_000) ?? '<missing>',
    bodyHtml: document.body?.innerHTML.slice(0, 2_000) ?? '<missing>',
    scripts: [...document.scripts].map((script) => script.src || '<inline>'),
  }))

  return { windows, document: documentState }
}

async function waitForText(text, timeout = 30000) {
  try {
    await browser.waitUntil(
      async () => (await appText()).includes(text),
      {
        timeout,
        timeoutMsg: `Expected the DataPad++ desktop shell to contain "${text}".`,
      },
    )
  } catch (error) {
    const visibleText = (await appText()).replace(/\s+/g, ' ').trim().slice(0, 1_000)
    const diagnostics = await appBootstrapDiagnostics()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${message} Visible desktop text: ${visibleText || '<empty>'}. Bootstrap: ${JSON.stringify(diagnostics)}`,
    )
  }
}

async function expectNoText(text) {
  assert.equal((await appText()).includes(text), false, `Unexpected text found: ${text}`)
}

async function clickControl(label) {
  const clicked = await browser.execute((targetLabel) => {
    const normalize = (value) => value?.replace(/\s+/g, ' ').trim() ?? ''
    const controls = [...document.querySelectorAll('button, [role="button"], [role="option"]')]
    const control = controls.find((element) => {
      const accessible =
        element.getAttribute('aria-label') ??
        element.getAttribute('title') ??
        normalize(element.textContent)
      return accessible === targetLabel || normalize(element.textContent) === targetLabel
    })

    if (!(control instanceof HTMLElement) || control.hasAttribute('disabled')) {
      return false
    }

    control.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    control.click()
    return true
  }, label)

  assert.equal(clicked, true, `Unable to click control "${label}".`)
}

async function setAriaControl(label, value, index = 0) {
  const updated = await browser.execute(
    ({ targetLabel, targetIndex, nextValue }) => {
      const ariaControls = [...document.querySelectorAll(`[aria-label="${CSS.escape(targetLabel)}"]`)]
      const labelledControls = [...document.querySelectorAll('label')]
        .filter((label) => label.textContent?.replace(/\s+/g, ' ').trim() === targetLabel)
        .map((label) => label.querySelector('input, select, textarea'))
        .filter(Boolean)
      const controls = ariaControls.length > 0 ? ariaControls : labelledControls
      const control = controls[targetIndex]
      if (!(
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement
      )) {
        return false
      }

      const prototype = control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : control instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, nextValue)
      control.dispatchEvent(new Event('input', { bubbles: true }))
      control.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    { targetLabel: label, targetIndex: index, nextValue: value },
  )

  assert.equal(updated, true, `Unable to set ${label} at index ${index}.`)
  await browser.waitUntil(
    async () => browser.execute(
      ({ targetLabel, targetIndex, nextValue }) => {
        const ariaControls = [...document.querySelectorAll(`[aria-label="${CSS.escape(targetLabel)}"]`)]
        const labelledControls = [...document.querySelectorAll('label')]
          .filter((label) => label.textContent?.replace(/\s+/g, ' ').trim() === targetLabel)
          .map((label) => label.querySelector('input, select, textarea'))
          .filter(Boolean)
        const control = (ariaControls.length > 0 ? ariaControls : labelledControls)[targetIndex]
        return (
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement
        ) && control.value === nextValue
      },
      { targetLabel: label, targetIndex: index, nextValue: value },
    ),
    { timeout: 5000, timeoutMsg: `Expected ${label} to retain its new value.` },
  )
}

async function setPluginCheckbox(title, enabled) {
  const changed = await browser.execute(
    ({ cardTitle, nextEnabled }) => {
      const card = [...document.querySelectorAll('.settings-plugin-card')].find(
        (candidate) => candidate.querySelector('h4')?.textContent?.trim() === cardTitle,
      )
      const checkbox = card?.querySelector('input[type="checkbox"]')
      if (!(checkbox instanceof HTMLInputElement)) {
        return false
      }
      if (checkbox.checked !== nextEnabled) {
        checkbox.click()
      }
      return true
    },
    { cardTitle: title, nextEnabled: enabled },
  )

  assert.equal(changed, true, `Unable to change the ${title} setting.`)
  await browser.waitUntil(
    async () => browser.execute(
      ({ cardTitle, nextEnabled }) => {
        const card = [...document.querySelectorAll('.settings-plugin-card')].find(
          (candidate) => candidate.querySelector('h4')?.textContent?.trim() === cardTitle,
        )
        const checkbox = card?.querySelector('input[type="checkbox"]')
        return checkbox instanceof HTMLInputElement && checkbox.checked === nextEnabled
      },
      { cardTitle: title, nextEnabled: enabled },
    ),
    { timeout: 20000, timeoutMsg: `Expected ${title} to become ${enabled ? 'enabled' : 'disabled'}.` },
  )
}

async function editorTabCount() {
  return browser.execute(
    () => document.querySelectorAll('[role="tablist"][aria-label="Editor tabs"] [role="tab"]').length,
  )
}

async function switchWorkspaceByName(workspaceName) {
  const target = await browser.execute((requestedName) => {
    const row = [...document.querySelectorAll('.workspace-switcher-row')].find(
      (candidate) => candidate.querySelector('strong')?.textContent?.trim() === requestedName,
    )
    const button = row?.querySelector('.workspace-switcher-main')
    if (!(button instanceof HTMLButtonElement)) {
      return { found: false, disabled: false }
    }
    const disabled = button.disabled
    if (!disabled) {
      button.click()
    }
    return { found: true, disabled }
  }, workspaceName)

  assert.equal(target.found, true, `Workspace "${workspaceName}" was not rendered.`)
  assert.equal(target.disabled, false, `Workspace "${workspaceName}" was already active.`)
  await browser.waitUntil(
    async () => browser.execute(
      (requestedName) => (
        document.querySelector('.workspace-switcher-row.is-active strong')?.textContent?.trim()
        === requestedName
      ),
      workspaceName,
    ),
    {
      timeout: 30000,
      timeoutMsg: `Expected workspace "${workspaceName}" to become active.`,
    },
  )
}

async function openActiveTabContextMenu() {
  const opened = await browser.execute(() => {
    const selectedTab = document.querySelector(
      '[role="tablist"][aria-label="Editor tabs"] [role="tab"][aria-selected="true"]',
    )
    if (!(selectedTab instanceof HTMLElement)) {
      return false
    }
    selectedTab.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 240,
      clientY: 100,
    }))
    return true
  })

  assert.equal(opened, true, 'Unable to open the active tab context menu.')
}

describe('DataPad++ native SQLite smoke', () => {
  it('starts with one local connection and no invented failure state', async () => {
    await waitForText('Fixture SQLite')
    await expectNoText('Fixture PostgreSQL')
    await expectNoText('Connection issue')
    await expectNoText('Checking connection')

    const badgeLabels = await browser.execute(
      () => [...document.querySelectorAll('.connection-health-badge')]
        .map((badge) => badge.getAttribute('aria-label')),
    )
    assert.deepEqual(
      badgeLabels.filter((label) => label !== 'Connected'),
      [],
      'Startup must not synthesize checking or failure health. A real metadata load may establish connected health.',
    )
  })

  it('executes a real SQLite query and records health from that evidence', async () => {
    await clickControl('Run query')
    await waitForText('3 row(s) returned from Fixture SQLite.', 60000)

    const connected = await browser.execute(
      () => Boolean(document.querySelector('.connection-health-badge.is-connected')),
    )
    assert.equal(connected, true, 'A successful datastore operation should mark SQLite connected.')
  })

  it('executes AND and OR builder drafts with distinct native results', async () => {
    await clickControl('Query Builder')
    await waitForText('No filters applied.')
    await clickControl('Add Filter')
    await clickControl('Add Filter')

    await setAriaControl('Filter field', 'status', 0)
    await setAriaControl('Filter value', 'active', 0)
    await setAriaControl('Filter field', 'id', 1)
    await setAriaControl('Filter operator', 'gt', 1)
    await setAriaControl('Filter value type', 'number', 1)
    await setAriaControl('Filter value', '1', 1)
    await setAriaControl('Filter logic', 'and')
    await clickControl('Run query')
    await waitForText('1 row(s) returned from Fixture SQLite.', 60000)

    await setAriaControl('Filter value', 'paused', 0)
    await setAriaControl('Filter operator', 'lt', 1)
    await setAriaControl('Filter value', '2', 1)
    await setAriaControl('Filter logic', 'or')
    await clickControl('Run query')
    await waitForText('2 row(s) returned from Fixture SQLite.', 60000)
  })

  it('switches the Explorer and tabs with the selected workspace', async () => {
    await clickControl('Open settings')
    await waitForText('Settings')
    await clickControl('Plugins')
    await waitForText('Workspaces')
    await setPluginCheckbox('Workspaces', true)
    await clickControl('Close tab Settings')
    await waitForText('WORKSPACES')

    const originalWorkspaceName = await browser.execute(
      () => document.querySelector('.workspace-switcher-row.is-active strong')?.textContent?.trim() ?? '',
    )
    assert.ok(originalWorkspaceName, 'Expected the seeded workspace to be active.')

    await clickControl('New workspace')
    await setAriaControl('Workspace name', 'Native Smoke Blank')
    await clickControl('Create')
    await waitForText('Start your workspace')
    assert.equal(
      await browser.execute(
        () => document.querySelector('.workspace-switcher-row.is-active strong')?.textContent?.trim(),
      ),
      'Native Smoke Blank',
      'The newly created workspace must become active immediately.',
    )
    assert.equal(await editorTabCount(), 0, 'A new workspace must not retain the previous tabs.')
    await expectNoText('Fixture SQLite')

    await switchWorkspaceByName(originalWorkspaceName)
    await waitForText('Fixture SQLite')
    assert.equal(await editorTabCount(), 1, 'Switching back must restore the seeded workspace tab.')
  })

  it('moves a tab to a native editor window and atomically returns it', async () => {
    const mainHandle = await browser.getWindowHandle()
    await clickControl('Open settings')
    await waitForText('Settings')
    await clickControl('Plugins')
    await waitForText('Experimental Plugins')
    await setPluginCheckbox('Multi-window Tabs', true)
    await clickControl('Close tab Settings')

    await openActiveTabContextMenu()
    await clickControl('Move to New Window')
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2, {
      timeout: 30000,
      timeoutMsg: 'Expected a detached DataPad++ editor window.',
    })

    const editorHandle = (await browser.getWindowHandles()).find((handle) => handle !== mainHandle)
    assert.ok(editorHandle, 'Unable to identify the detached editor window.')
    await browser.switchToWindow(editorHandle)
    await waitForText('Fixture SQLite')
    assert.equal(
      await browser.execute(() => Boolean(document.querySelector('.workbench-sidebar'))),
      false,
      'Detached editor windows must not duplicate the main Explorer shell.',
    )

    await openActiveTabContextMenu()
    await clickControl('Move to Main Window')
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, {
      timeout: 30000,
      timeoutMsg: 'Expected the empty editor window to close after returning its last tab.',
    })
    await browser.switchToWindow(mainHandle)
    await waitForText('Fixture SQLite')
    assert.equal(await editorTabCount(), 1, 'The main window must regain exactly one moved tab.')
  })
})
