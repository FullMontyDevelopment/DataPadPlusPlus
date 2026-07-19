fn docs_html(state: &ApiServerRuntime, config: &DatastoreApiServerConfig) -> String {
    docs_html_for(
        state.port,
        &state.connection_id,
        &state.environment_id,
        config,
    )
}

fn docs_html_for(
    port: u16,
    connection_id: &str,
    environment_id: &str,
    config: &DatastoreApiServerConfig,
) -> String {
    let base_url = format!("http://{API_HOST}:{port}");
    if config.protocol != "rest" {
        return protocol_docs_html(&base_url, connection_id, environment_id, config);
    }
    rest_docs_html(&base_url, connection_id, environment_id, config)
}

fn rest_docs_html(
    base_url: &str,
    connection_id: &str,
    environment_id: &str,
    config: &DatastoreApiServerConfig,
) -> String {
    let description = config
        .description
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Runnable OpenAPI docs for the configured datastore resources.");
    let template = r###"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__SERVER_NAME__ OpenAPI Docs</title>
  <style>__DOCS_CSS__</style>
</head>
<body data-docs-protocol="rest">
  <aside class="scalar-sidebar" aria-label="API Reference navigation">
    <div class="docs-brand">
      <span>Experimental</span>
      <strong>__SERVER_NAME__</strong>
      <small>__BASE_URL__</small>
    </div>
    <label class="search-shell" for="operationSearch">
      <span aria-hidden="true">Search</span>
      <input id="operationSearch" type="search" placeholder="Search operations">
      <kbd>^ K</kbd>
    </label>
    <nav id="resourceNav" class="resource-nav" aria-label="Resources"></nav>
    <div class="sidebar-footer">
      <a href="/openapi.json" target="_blank" rel="noreferrer">OpenAPI JSON</a>
    </div>
  </aside>

  <main class="scalar-main">
    <section class="intro-panel">
      <div class="badge-row">
        <span class="badge">OpenAPI 3.1</span>
        <span class="badge">Local only</span>
        <span class="badge">JSON mutations</span>
      </div>
      <h1>__SERVER_NAME__</h1>
      <p>__SERVER_DESCRIPTION__</p>
      <dl class="metadata-grid">
        <div><dt>Server</dt><dd><code>__BASE_URL__</code></dd></div>
        <div><dt>Connection</dt><dd><code>__CONNECTION_ID__</code></dd></div>
        <div><dt>Environment</dt><dd><code>__ENVIRONMENT_ID__</code></dd></div>
      </dl>
    </section>

    <section class="content-section" id="resources">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Resources</span>
          <h2>Configured CRUD endpoints</h2>
        </div>
        <button class="ghost-button" id="reloadSpec" type="button">Refresh</button>
      </div>
      <div id="resourceOverview" class="resource-grid"></div>
    </section>

    <section class="content-section" id="operationDetails" aria-live="polite">
      <div class="empty-state">Select an operation from the sidebar.</div>
    </section>
  </main>

  <aside id="requestPanel" class="request-panel" aria-label="Request runner">
    <div class="panel-tabs" aria-hidden="true">
      <span class="is-active"></span>
    </div>
    <section class="panel-block">
      <span class="eyebrow">Server</span>
      <select id="serverSelect" aria-label="Server">
        <option value="__BASE_URL__">__BASE_URL__</option>
      </select>
    </section>

    <section class="panel-block">
      <div class="request-line">
        <span id="methodBadge" class="method-badge get">GET</span>
        <input id="requestPath" aria-label="Request path" spellcheck="false">
        <button id="sendRequest" class="send-button" type="button">Send</button>
      </div>
      <small class="muted">Use Ctrl+Enter to send the selected request.</small>
    </section>

    <section class="panel-block">
      <button class="collapse-header" type="button" data-toggle="paramsPanel">Parameters</button>
      <div id="paramsPanel" class="field-stack"></div>
    </section>

    <section class="panel-block">
      <button class="collapse-header" type="button" data-toggle="bodyPanel">Request Body</button>
      <div id="bodyPanel">
        <textarea id="requestBody" aria-label="JSON request body" spellcheck="false"></textarea>
      </div>
    </section>

    <section class="panel-block">
      <button class="collapse-header" type="button" data-toggle="snippetPanel">Code Snippet</button>
      <pre id="snippetPanel" class="code-block"></pre>
    </section>

    <section class="panel-block response-block">
      <div class="section-heading section-heading--compact">
        <div>
          <span class="eyebrow">Response</span>
          <h2 id="responseStatus">Ready</h2>
        </div>
        <span id="responseTime" class="muted"></span>
      </div>
      <pre id="responseOutput" class="code-block">Select an operation, then send a request.</pre>
    </section>
  </aside>

  <script>__DOCS_SCRIPT__</script>
</body>
</html>"###;
    template
        .replace("__DOCS_CSS__", docs_css())
        .replace("__DOCS_SCRIPT__", docs_script())
        .replace("__SERVER_NAME__", &html_escape(&config.name))
        .replace("__SERVER_DESCRIPTION__", &html_escape(description))
        .replace("__BASE_URL__", &html_escape(base_url))
        .replace("__CONNECTION_ID__", &html_escape(connection_id))
        .replace("__ENVIRONMENT_ID__", &html_escape(environment_id))
}

fn protocol_docs_html(
    base_url: &str,
    connection_id: &str,
    environment_id: &str,
    config: &DatastoreApiServerConfig,
) -> String {
    let protocol = config.protocol.as_str();
    let title = match protocol {
        "graphql" => "GraphQL API",
        "grpc" => "gRPC API",
        _ => "API Server",
    };
    let body = match protocol {
        "graphql" => {
            r###"
      <div class="operation-card">
        <span class="method-badge get">GET</span>
        <code>/graphql</code>
        <p>Returns the generated schema and configured resource metadata.</p>
      </div>
      <div class="operation-card">
        <span class="method-badge post">POST</span>
        <code>/graphql</code>
        <p>Runs GraphQL queries and mutations for configured resources.</p>
      </div>
      <pre class="code-block">{
  "query": "query { users(limit: 10) }"
}</pre>
"###
        }
        "grpc" => {
            r###"
      <div class="operation-card">
        <span class="method-badge get">GET</span>
        <code>/proto</code>
        <p>Returns generated proto metadata and resource services.</p>
      </div>
      <div class="operation-card">
        <span class="method-badge get">GET</span>
        <code>/datapad.proto</code>
        <p>Returns the generated proto document for grpcurl or native clients.</p>
      </div>
      <pre class="code-block">grpcurl -plaintext 127.0.0.1:PORT list</pre>
"###
        }
        _ => {
            r###"
      <p>This protocol does not expose an OpenAPI document.</p>
"###
        }
    };
    let template = r###"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__SERVER_NAME__ Docs</title>
  <style>__DOCS_CSS__</style>
</head>
<body data-docs-protocol="__PROTOCOL__">
  <main class="protocol-docs">
    <section class="intro-panel">
      <div class="badge-row">
        <span class="badge">Experimental</span>
        <span class="badge">__PROTOCOL_LABEL__</span>
        <span class="badge">Local only</span>
      </div>
      <h1>__SERVER_NAME__</h1>
      <p>__PROTOCOL_LABEL__ servers do not expose an OpenAPI document. Use the protocol endpoint metadata below.</p>
      <dl class="metadata-grid">
        <div><dt>Server</dt><dd><code>__BASE_URL__</code></dd></div>
        <div><dt>Connection</dt><dd><code>__CONNECTION_ID__</code></dd></div>
        <div><dt>Environment</dt><dd><code>__ENVIRONMENT_ID__</code></dd></div>
      </dl>
    </section>
    <section class="content-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Protocol</span>
          <h2>__PROTOCOL_TITLE__</h2>
        </div>
      </div>
      __PROTOCOL_BODY__
    </section>
  </main>
</body>
</html>"###;
    template
        .replace("__DOCS_CSS__", docs_css())
        .replace("__SERVER_NAME__", &html_escape(&config.name))
        .replace("__BASE_URL__", &html_escape(base_url))
        .replace("__CONNECTION_ID__", &html_escape(connection_id))
        .replace("__ENVIRONMENT_ID__", &html_escape(environment_id))
        .replace("__PROTOCOL__", &html_escape(protocol))
        .replace("__PROTOCOL_LABEL__", title)
        .replace("__PROTOCOL_TITLE__", title)
        .replace("__PROTOCOL_BODY__", body)
}

fn docs_css() -> &'static str {
    r###"
:root {
  color-scheme: dark;
  --bg: #08090b;
  --panel: #111214;
  --panel-raised: #18191c;
  --panel-soft: #0d0e10;
  --text: #f4f4f5;
  --muted: #9ca3af;
  --faint: #686f7d;
  --border: #2a2c31;
  --border-strong: #3b3d44;
  --accent: #8ab4ff;
  --get: #16a3ff;
  --post: #22c55e;
  --patch: #f59e0b;
  --delete: #f87171;
  --shadow: rgba(0, 0, 0, 0.36);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  grid-template-columns: 280px minmax(420px, 1fr) 430px;
  background: var(--bg);
  color: var(--text);
}
button, input, select, textarea {
  font: inherit;
}
code, pre, textarea, input {
  font-family: "Cascadia Code", Consolas, ui-monospace, monospace;
  letter-spacing: 0;
}
button {
  cursor: pointer;
}
a { color: inherit; }
.scalar-sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  min-width: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 12px;
  padding: 18px 12px;
  border-right: 1px solid var(--border);
  background: #0b0c0e;
  overflow: hidden;
}
.docs-brand {
  display: grid;
  gap: 4px;
  padding: 0 8px;
}
.docs-brand span, .eyebrow {
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.docs-brand strong {
  min-width: 0;
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.docs-brand small,
.muted {
  color: var(--muted);
  font-size: 12px;
}
.search-shell {
  min-width: 0;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 8px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--faint);
}
.search-shell input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
}
kbd {
  padding: 1px 5px;
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
}
.resource-nav {
  min-width: 0;
  overflow: auto;
  padding-right: 2px;
}
.nav-group {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
}
.nav-group-title {
  padding: 8px;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}
.nav-operation {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  text-align: left;
}
.nav-operation:hover,
.nav-operation.is-active {
  border-color: var(--border);
  background: var(--panel);
  color: var(--text);
}
.nav-operation span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-footer {
  padding: 10px 8px 0;
  border-top: 1px solid var(--border);
}
.sidebar-footer a {
  color: var(--muted);
  font-size: 12px;
}
.scalar-main {
  min-width: 0;
  display: grid;
  gap: 18px;
  align-content: start;
  padding: 90px 60px 80px;
}
.protocol-docs {
  max-width: 980px;
  min-height: 100vh;
  display: grid;
  gap: 18px;
  align-content: start;
  padding: 80px 48px;
  margin: 0 auto;
}
.intro-panel,
.content-section,
.request-panel,
.operation-card {
  border: 1px solid var(--border);
  background: var(--panel);
}
.intro-panel {
  display: grid;
  gap: 16px;
  padding: 24px;
}
.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.badge {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid var(--border);
  background: var(--panel-raised);
  color: var(--muted);
  font-size: 12px;
}
h1, h2, h3, p, dl, dd {
  margin: 0;
}
h1 {
  font-size: 28px;
  line-height: 1.15;
}
h2 {
  font-size: 16px;
}
h3 {
  font-size: 14px;
}
p {
  color: #d5d7dc;
  font-size: 14px;
  line-height: 1.65;
}
.metadata-grid,
.resource-grid,
.operation-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.metadata-grid div,
.resource-card,
.param-row {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border);
  background: var(--panel-soft);
}
dt {
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
dd,
code {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 13px;
}
.content-section {
  display: grid;
  gap: 14px;
  padding: 18px;
}
.section-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.section-heading--compact {
  align-items: start;
}
.resource-card strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-card small {
  color: var(--muted);
}
.operation-card {
  display: grid;
  gap: 12px;
  padding: 16px;
}
.operation-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.operation-title code {
  font-size: 15px;
}
.method-badge {
  min-width: 44px;
  display: inline-flex;
  justify-content: center;
  padding: 2px 6px;
  border: 1px solid var(--border);
  background: var(--panel-raised);
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}
.method-badge.get { color: var(--get); }
.method-badge.post { color: var(--post); }
.method-badge.patch { color: var(--patch); }
.method-badge.delete { color: var(--delete); }
.field-stack {
  display: grid;
  gap: 8px;
}
.field-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(90px, 0.7fr) minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.field-row label {
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
}
input,
select,
textarea {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  background: #0c0d10;
  color: var(--text);
}
textarea {
  min-height: 170px;
  resize: vertical;
}
.ghost-button,
.send-button,
.collapse-header {
  min-height: 32px;
  border: 1px solid var(--border);
  background: var(--panel-raised);
  color: var(--text);
}
.ghost-button {
  padding: 5px 10px;
}
.collapse-header {
  width: 100%;
  display: flex;
  justify-content: space-between;
  padding: 8px 10px;
  text-align: left;
}
.collapse-header::after {
  content: "All";
  color: var(--muted);
  font-size: 11px;
}
.request-panel {
  position: sticky;
  top: 0;
  height: 100vh;
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 18px;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  overflow: auto;
  box-shadow: -18px 0 44px var(--shadow);
}
.panel-tabs {
  display: flex;
  justify-content: center;
  min-height: 6px;
}
.panel-tabs span {
  width: 72px;
  border-top: 1px solid var(--text);
}
.panel-block {
  display: grid;
  gap: 8px;
}
.request-line {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
}
.send-button {
  padding: 5px 11px;
  background: var(--text);
  color: var(--bg);
  font-weight: 700;
}
.code-block {
  min-height: 120px;
  max-height: 360px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid var(--border);
  background: #090a0c;
  color: #dfe3ea;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.response-block .code-block {
  min-height: 220px;
}
.empty-state {
  padding: 24px;
  border: 1px dashed var(--border);
  color: var(--muted);
}
.is-hidden {
  display: none !important;
}
@media (max-width: 1180px) {
  body {
    grid-template-columns: 260px minmax(0, 1fr);
  }
  .request-panel {
    position: static;
    height: auto;
    grid-column: 1 / -1;
    border-top: 1px solid var(--border);
    border-left: 0;
    box-shadow: none;
  }
  .scalar-main {
    padding: 40px 28px;
  }
}
@media (max-width: 760px) {
  body {
    display: block;
  }
  .scalar-sidebar {
    position: static;
    height: auto;
  }
  .scalar-main,
  .protocol-docs {
    padding: 18px;
  }
}
"###
}

fn docs_script() -> &'static str {
    r###"
const docsState = {
  spec: null,
  operations: [],
  selectedId: null
};

const methodOrder = { GET: 1, POST: 2, PATCH: 3, DELETE: 4 };
const operationSearch = document.getElementById('operationSearch');
const resourceNav = document.getElementById('resourceNav');
const resourceOverview = document.getElementById('resourceOverview');
const operationDetails = document.getElementById('operationDetails');
const serverSelect = document.getElementById('serverSelect');
const methodBadge = document.getElementById('methodBadge');
const requestPath = document.getElementById('requestPath');
const paramsPanel = document.getElementById('paramsPanel');
const requestBody = document.getElementById('requestBody');
const snippetPanel = document.getElementById('snippetPanel');
const responseStatus = document.getElementById('responseStatus');
const responseTime = document.getElementById('responseTime');
const responseOutput = document.getElementById('responseOutput');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function asJson(value) {
  return JSON.stringify(value, null, 2);
}

function slug(value) {
  return String(value || 'operation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'operation';
}

function methodClass(method) {
  return method.toLowerCase();
}

function firstExample(requestBodySpec) {
  const content = requestBodySpec?.content?.['application/json'];
  const examples = content?.examples || {};
  const first = Object.values(examples)[0];
  if (first && Object.prototype.hasOwnProperty.call(first, 'value')) {
    return first.value;
  }
  return undefined;
}

function collectOperations(spec) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [methodName, operation] of Object.entries(pathItem || {})) {
      const method = methodName.toUpperCase();
      if (!methodOrder[method]) continue;
      const resource = operation['x-datapad-resource'] || {};
      const id = operation.operationId || `${method}-${path}`;
      operations.push({
        id,
        domId: slug(`${method}-${id}-${path}`),
        method,
        path,
        tag: (operation.tags && operation.tags[0]) || resource.name || 'Resources',
        summary: operation.summary || id,
        description: operation.description || '',
        operation,
        resource
      });
    }
  }
  operations.sort((left, right) => {
    const tag = left.tag.localeCompare(right.tag);
    if (tag !== 0) return tag;
    return (methodOrder[left.method] || 99) - (methodOrder[right.method] || 99);
  });
  return operations;
}

function operationMatches(operation, filter) {
  if (!filter) return true;
  const haystack = [
    operation.method,
    operation.path,
    operation.summary,
    operation.description,
    operation.id,
    operation.tag,
    operation.resource.kind,
    operation.resource.detail
  ].join(' ').toLowerCase();
  return haystack.includes(filter);
}

function renderNavigation() {
  const filter = operationSearch.value.trim().toLowerCase();
  const groups = new Map();
  docsState.operations
    .filter((operation) => operationMatches(operation, filter))
    .forEach((operation) => {
      if (!groups.has(operation.tag)) groups.set(operation.tag, []);
      groups.get(operation.tag).push(operation);
    });
  if (!groups.size) {
    resourceNav.innerHTML = '<div class="empty-state">No operations match this search.</div>';
    return;
  }
  resourceNav.innerHTML = Array.from(groups.entries()).map(([tag, operations]) => `
    <section class="nav-group">
      <div class="nav-group-title">${escapeHtml(tag)}</div>
      ${operations.map((operation) => `
        <button class="nav-operation${operation.id === docsState.selectedId ? ' is-active' : ''}" type="button" data-operation-id="${escapeHtml(operation.id)}">
          <span class="method-badge ${methodClass(operation.method)}">${escapeHtml(operation.method)}</span>
          <span>${escapeHtml(operation.summary)}</span>
        </button>
      `).join('')}
    </section>
  `).join('');
  resourceNav.querySelectorAll('button[data-operation-id]').forEach((button) => {
    button.addEventListener('click', () => selectOperation(button.dataset.operationId, true));
  });
}

function renderOverview() {
  const resources = docsState.spec?.['x-datapad']?.resources || [];
  if (!resources.length) {
    resourceOverview.innerHTML = '<div class="empty-state">No CRUD resources are configured for this API server.</div>';
    return;
  }
  resourceOverview.innerHTML = resources.map((resource) => `
    <article class="resource-card">
      <strong>${escapeHtml(resource.name || resource.label || resource.endpoint)}</strong>
      <small>${escapeHtml(resource.kind || 'resource')}${resource.detail ? ` / ${escapeHtml(resource.detail)}` : ''}</small>
      <code>${escapeHtml(resource.endpoint || '')}</code>
    </article>
  `).join('');
}

function renderOperationDetails(operation) {
  const parameters = operation.operation.parameters || [];
  const requestExample = firstExample(operation.operation.requestBody);
  const responses = operation.operation.responses || {};
  operationDetails.innerHTML = `
    <article class="operation-card" id="${escapeHtml(operation.domId)}">
      <div class="operation-title">
        <span class="method-badge ${methodClass(operation.method)}">${escapeHtml(operation.method)}</span>
        <code>${escapeHtml(operation.path)}</code>
      </div>
      <div>
        <span class="eyebrow">${escapeHtml(operation.tag)}</span>
        <h2>${escapeHtml(operation.summary)}</h2>
      </div>
      <p>${escapeHtml(operation.description || 'No description provided.')}</p>
      <div class="operation-meta">
        <div class="resource-card"><dt>Resource kind</dt><dd>${escapeHtml(operation.resource.kind || 'resource')}</dd></div>
        <div class="resource-card"><dt>Operation id</dt><dd><code>${escapeHtml(operation.id)}</code></dd></div>
      </div>
      <h3>Parameters</h3>
      ${parameters.length ? parameters.map((parameter) => `
        <div class="param-row">
          <dt>${escapeHtml(parameter.name)} <span class="muted">${escapeHtml(parameter.in)}</span></dt>
          <dd>${escapeHtml(parameter.description || parameter.schema?.type || 'value')}</dd>
        </div>
      `).join('') : '<p class="muted">No parameters.</p>'}
      <h3>Request body</h3>
      ${requestExample === undefined ? '<p class="muted">No JSON body is required.</p>' : `<pre class="code-block">${escapeHtml(asJson(requestExample))}</pre>`}
      <h3>Responses</h3>
      ${Object.entries(responses).map(([status, response]) => `
        <div class="param-row">
          <dt>${escapeHtml(status)}</dt>
          <dd>${escapeHtml(response.description || 'Response')}</dd>
        </div>
      `).join('')}
    </article>
  `;
}

function renderParameterInputs(operation) {
  const parameters = operation.operation.parameters || [];
  if (!parameters.length) {
    paramsPanel.innerHTML = '<p class="muted">No parameters.</p>';
    return;
  }
  paramsPanel.innerHTML = parameters.map((parameter) => {
    const value = parameter.example ?? (parameter.name === 'limit' ? 50 : '1');
    return `
      <div class="field-row">
        <label for="param-${escapeHtml(parameter.name)}">${escapeHtml(parameter.name)} <span class="muted">${escapeHtml(parameter.in)}</span></label>
        <input id="param-${escapeHtml(parameter.name)}" data-param-name="${escapeHtml(parameter.name)}" data-param-in="${escapeHtml(parameter.in)}" value="${escapeHtml(value)}" spellcheck="false">
      </div>
    `;
  }).join('');
  paramsPanel.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateSnippet);
  });
}

function selectedOperation() {
  return docsState.operations.find((operation) => operation.id === docsState.selectedId);
}

function buildRequestPath() {
  const operation = selectedOperation();
  if (!operation) return requestPath.value || '/';
  let path = operation.path;
  const query = new URLSearchParams();
  paramsPanel.querySelectorAll('input[data-param-name]').forEach((input) => {
    const name = input.dataset.paramName;
    const value = input.value.trim();
    if (!value) return;
    if (input.dataset.paramIn === 'path') {
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    } else if (input.dataset.paramIn === 'query') {
      query.set(name, value);
    }
  });
  const queryText = query.toString();
  return queryText ? `${path}?${queryText}` : path;
}

function updateSnippet() {
  const operation = selectedOperation();
  if (!operation) return;
  const path = buildRequestPath();
  requestPath.value = path;
  const lines = [`curl -X ${operation.method} "${serverSelect.value}${path}"`];
  const body = requestBody.value.trim();
  if (body && (operation.method === 'POST' || operation.method === 'PATCH')) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push(`  -d '${body.replaceAll("'", "'\\''")}'`);
  }
  snippetPanel.textContent = lines.join(' \\\n');
}

function selectOperation(operationId, pushHash) {
  const operation = docsState.operations.find((candidate) => candidate.id === operationId) || docsState.operations[0];
  if (!operation) return;
  docsState.selectedId = operation.id;
  methodBadge.textContent = operation.method;
  methodBadge.className = `method-badge ${methodClass(operation.method)}`;
  renderNavigation();
  renderOperationDetails(operation);
  renderParameterInputs(operation);
  const example = firstExample(operation.operation.requestBody);
  requestBody.value = example === undefined ? '' : asJson(example);
  responseStatus.textContent = 'Ready';
  responseTime.textContent = '';
  responseOutput.textContent = 'Ready.';
  updateSnippet();
  if (pushHash) {
    history.replaceState(null, '', `#${operation.domId}`);
  }
}

async function loadSpec() {
  resourceNav.innerHTML = '<div class="empty-state">Loading OpenAPI document.</div>';
  const response = await fetch('/openapi.json');
  docsState.spec = await response.json();
  docsState.operations = collectOperations(docsState.spec);
  renderOverview();
  const hash = location.hash.replace(/^#/, '');
  const hashOperation = docsState.operations.find((operation) => operation.domId === hash);
  selectOperation(hashOperation?.id || docsState.operations[0]?.id, false);
}

async function sendRequest() {
  const operation = selectedOperation();
  if (!operation) {
    responseOutput.textContent = 'Select an operation first.';
    return;
  }
  const path = buildRequestPath();
  const headers = {};
  const options = { method: operation.method, headers };
  const body = requestBody.value.trim();
  if (body && (operation.method === 'POST' || operation.method === 'PATCH')) {
    headers['Content-Type'] = 'application/json';
    options.body = body;
  }
  responseStatus.textContent = 'Sending';
  responseTime.textContent = '';
  responseOutput.textContent = '';
  const started = performance.now();
  try {
    const response = await fetch(path, options);
    const elapsed = Math.round((performance.now() - started) * 100) / 100;
    const text = await response.text();
    let output = text;
    try {
      output = asJson(JSON.parse(text));
    } catch {}
    responseStatus.textContent = `${response.status} ${response.statusText}`;
    responseTime.textContent = `${elapsed} ms`;
    responseOutput.textContent = output || '(empty response)';
  } catch (error) {
    responseStatus.textContent = 'Request failed';
    responseOutput.textContent = String(error);
  }
}

document.getElementById('reloadSpec').addEventListener('click', loadSpec);
document.getElementById('sendRequest').addEventListener('click', sendRequest);
operationSearch.addEventListener('input', renderNavigation);
serverSelect.addEventListener('change', updateSnippet);
requestBody.addEventListener('input', updateSnippet);
requestPath.addEventListener('input', updateSnippet);
document.querySelectorAll('[data-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    document.getElementById(button.dataset.toggle).classList.toggle('is-hidden');
  });
});
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    operationSearch.focus();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    sendRequest();
  }
});
window.addEventListener('hashchange', () => {
  const hash = location.hash.replace(/^#/, '');
  const operation = docsState.operations.find((candidate) => candidate.domId === hash);
  if (operation) selectOperation(operation.id, false);
});

loadSpec().catch((error) => {
  resourceNav.innerHTML = `<div class="empty-state">${escapeHtml(error.message || error)}</div>`;
  operationDetails.innerHTML = '<div class="empty-state">Unable to load /openapi.json.</div>';
});
"###
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

struct HttpResponse {
    status: u16,
    reason: &'static str,
    content_type: &'static str,
    body: Vec<u8>,
    error_code: Option<String>,
    error_message: Option<String>,
}

fn json_response<T: Serialize>(status: u16, body: T) -> HttpResponse {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    };
    HttpResponse {
        status,
        reason,
        content_type: "application/json; charset=utf-8",
        body: serde_json::to_vec(&body)
            .unwrap_or_else(|_| b"{\"error\":\"serialization\"}".to_vec()),
        error_code: None,
        error_message: None,
    }
}

fn html_response(status: u16, body: String) -> HttpResponse {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    HttpResponse {
        status,
        reason,
        content_type: "text/html; charset=utf-8",
        body: body.into_bytes(),
        error_code: None,
        error_message: None,
    }
}

fn json_error_response(
    status: u16,
    code: impl Into<String>,
    message: impl Into<String>,
    details: Option<Value>,
) -> HttpResponse {
    let code = code.into();
    let message = message.into();
    let mut response = json_response(
        status,
        json!({ "error": { "code": code, "message": message, "details": details } }),
    );
    let error = response_error_from_body(&response.body);
    response.error_code = error.0;
    response.error_message = error.1;
    response
}

fn http_error(status: u16, code: &str, message: &str) -> HttpResponse {
    json_error_response(status, code, message, None)
}

fn response_error_from_body(body: &[u8]) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return (None, None);
    };
    let error = value.get("error");
    let code = error
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let message = error
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string);
    (code, message)
}

async fn write_response(
    stream: &mut TcpStream,
    response: HttpResponse,
) -> Result<(), std::io::Error> {
    let headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        response.status,
        response.reason,
        response.content_type,
        response.body.len()
    );
    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(&response.body).await?;
    stream.shutdown().await
}

#[derive(Debug)]
struct ApiRouteError {
    status: u16,
    code: String,
    message: String,
    details: Option<Box<Value>>,
}

impl ApiRouteError {
    fn new(status: u16, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }
}

impl From<CommandError> for ApiRouteError {
    fn from(error: CommandError) -> Self {
        Self {
            status: 500,
            code: error.code,
            message: error.message,
            details: None,
        }
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/runtime/datastore_api_server/documentation_tests.rs"]
mod tests;
