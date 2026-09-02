# DataPad++ Website Screenshots

Documentation images are registered centrally in `src/data/screenshots.ts`. Every entry must include a real image path, meaningful alternative text, a caption, and a deterministic capture case. Datastore guides additionally require unique connection-form and representative-workflow captures.

For a generic professional screenshot workspace, start and seed fixtures, then launch the desktop app with the screenshot seed:

```powershell
npm run fixtures:up:all
npm run fixtures:seed:all
npm run fixtures:screenshot-seed
```

That workspace enables the screenshot-friendly Plugins, creates Local Demo/Staging/Production Preview environments, and adds curated connections, folders, tabs, and saved queries across SQL, document, cache, search, analytics, and graph datastores.

The automated WebdriverIO/Tauri program uses `tests/fixtures/.screenshot-workspace` instead of your normal DataPad++ workspace. Run the two suites serially: the first creates the isolated workspace and all 58 datastore captures; the second adds the common inspector and transfer captures.

```powershell
Push-Location $env:TEMP
node 'C:\path\to\DataPad++\node_modules\@wdio\cli\bin\wdio.js' run 'C:\path\to\DataPad++\apps\desktop\e2e\wdio.docs-screenshots.conf.mjs'
node 'C:\path\to\DataPad++\node_modules\@wdio\cli\bin\wdio.js' run 'C:\path\to\DataPad++\apps\desktop\e2e\wdio.docs-common-screenshots.conf.mjs'
Pop-Location
```

The suite fixes the application window at 1600×1000 and injects capture-only CSS that removes cursors, blinking carets, animation, transitions, selection highlights, and focus outlines. WebDriver screenshot APIs capture the rendered window without the operating-system mouse pointer. The shared transfer case uses a credential-free fixture destination; its failed job is intentional troubleshooting evidence and never contacts a production system.

Recommended names:

- `hero-workbench.png`
- `connection-wizard.png`
- `library-environments.png`
- `explorer-tree.png`
- `sql-query-results.png`
- `mongodb-builder.png`
- `redis-browser.png`
- `search-diagnostics.png`
- `import-export.png`
- `result-export.png`
- `settings-backups.png`
- `download-release.png`
- `safety-preview.png`
- `api-server.png`
- `mcp-server.png`
- `workspace-search.png`
- `test-suites.png`
- `relationship-explorer.png`
- `typed-query-builder.png`
- `document-editor.png`
- `key-value-inspector.png`
- `datastore-transfer.png`
- `transfer-center.png`
- `workspace-import-review.png`
- `multi-window-tabs.png`
- `oracle-paging.png`

Use the screenshot workspace only. Before committing, inspect every image at full resolution for pointers, credentials, complete connection strings, personal paths, private query text, signed URLs, user workspace names, clipping, stale dialogs, and misleading live-status claims. Keep connection/environment context visible when it explains the action and confirm text remains readable at the website's compact figure size. Shared images must be marked explicitly in datastore guide data.
