# Experimental Multi-window Tabs

Multi-window Tabs is a first-party experimental desktop plugin. It keeps one DataPad++ application/backend while allowing eligible working tabs to appear in separate native windows.

> [!WARNING]
> The feature is disabled by default. Cross-WebView dragging can vary by WebView2, WKWebView, WebKitGTK, X11, Wayland, display scaling, and platform file-drop behavior. Use the Move commands whenever dragging is unavailable or unreliable.

## Enable It

Open **Settings → Plugins → Multi-window Tabs** and enable the Experimental plugin. Browser preview uses one synthetic main window and does not expose native window controls.

## Move Tabs

Eligible tab context menus provide:

- **Move to New Window**;
- **Move to Window…**;
- **Move to Main Window**.

Within a window, drag a tab header to the insertion marker to reorder it. Hold near the strip's left or right edge to scroll hidden tabs into view. Escape cancels; dropping outside the strip leaves the order unchanged. Reordering preserves the selected tab, drafts, pins, and environment colors. You can also focus a header and press **Alt+Shift+Left/Right**, or use its context-menu Move commands. Local reordering does not require the experimental plugin.

Cross-window dragging is currently unavailable. Use the Move commands to detach a tab or move it between windows. Windows cannot be considered drag-capable merely because it uses WebView2: the current native file-drop handler intercepts HTML drag/drop. Local pointer-based reordering remains available with the plugin both enabled and disabled, and native file-drop handling is unchanged. Cross-window gestures must pass the platform feasibility checks before being enabled again.

Running or queued work blocks transfer. DataPad++ flushes editor/builder drafts before moving a tab and transfers ownership atomically only after a new window reports ready. Failure leaves the tab in its source window.

## Window Roles

The main window owns Explorer, activity navigation, settings, environments, API/MCP administration, startup checks, updates, tray integration, and workspace switching. Editor windows contain working tabs, editor toolbars, results, and status.

Working query/script/builder, object, Explorer/structure, metrics, test, and search tabs can detach. Settings, environments, API Server, MCP Server, and security administration remain in main.

## Lifecycle

- Closing an editor window reattaches its tabs to main.
- Moving the last tab out closes the empty editor window.
- Closing main starts one application-wide shutdown flow.
- Disabling the plugin reattaches tabs and resets detached layout after draft flush; running work blocks disablement.
- Workspace switching closes old editor windows and restores the selected workspace's layout.
- Bounds are clamped to a visible monitor on restore.
- Theme, lock state, environments, connections, executions, and workspace revisions synchronize through the shared backend.

## Safety Invariants

Every tab has exactly one owner. Transfers use the invoking window as source context, ignore stale revisions, and cannot duplicate results or apply drafts to another window. The persisted layout stores tab ids and geometry, never separate datastore sessions or secrets.
