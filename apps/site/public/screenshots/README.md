# DataPad++ Website Screenshots

Replace the placeholders in the website by adding final screenshots here and updating the matching entries in `src/data/screenshots.ts`.

For a generic professional screenshot workspace, start and seed fixtures, then launch the desktop app with the screenshot seed:

```powershell
npm run fixtures:up:all
npm run fixtures:seed:all
npm run fixtures:screenshot-seed
```

That workspace enables the screenshot-friendly Plugins, creates Local Demo/Staging/Production Preview environments, and adds curated connections, folders, tabs, and saved queries across SQL, document, cache, search, analytics, and graph datastores.

The launcher uses `tests/fixtures/.screenshot-workspace` instead of your normal DataPad++ workspace and resets it before launch by default.

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
