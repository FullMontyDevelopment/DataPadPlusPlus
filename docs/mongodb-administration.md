# MongoDB users, roles and system views

DataPad++ is pre-release software. Use disposable or read-only systems while testing and keep independent recovery procedures.

## Open the correct scope

Expand a MongoDB connection, then **System Databases → admin** (or the database that owns the principal). Right-click **Users → Manage Users** or **Roles → Manage Roles**. Individual user and role nodes open the same management workflow.

The owning database is shown explicitly; a connection's default database does not override it. Refresh older open management tabs after updating DataPad++. Existing reversed section IDs remain readable, including GridFS and database-statistics tabs.

## Create, edit or remove

- **New user / New role** opens a form. Assign multiple roles with an explicit database for each.
- The pencil action edits an existing principal; its name and owning database cannot be changed.
- A custom role can have inherited roles, native privilege objects, or both. An empty array removes that list.
- Advanced options accept native authentication restrictions and, for users, custom data and authentication mechanisms.
- Leaving an advanced property blank leaves it unchanged. Role and privilege arrays replace the entire previous list, so review all entries before confirming.
- The delete action requires confirmation. Built-in roles remain visible but cannot be edited or removed.
- Drafts remain available after canceled confirmation or failed execution. Changing the tab, connection or environment cannot apply that draft to another target.

## Passwords

Create an environment **secret variable**, then reference it as `{{MONGO_USER_PASSWORD}}`. The selected tab's environment must resolve that secret. Plaintext passwords are not accepted in the management form.

On user edits, leave Password variable blank to preserve the existing password. Supply another secret reference to replace it. Users in `$external` do not receive a database password. Resolved passwords stay in the backend; operation reviews and responses omit them.

## Permissions and limitations

Desktop execution uses `createUser`, `updateUser`, `dropUser`, `createRole`, `updateRole` and `dropRole`. Read-only connections and environment confirmation safeguards still apply. MongoDB enforces the connected identity's administration privileges.

These native commands are not a replacement for Atlas's control-plane user management. Browser preview remains plan-only. Search/vector-index availability remains deployment-specific and is reported explicitly rather than shown as an unexplained empty inventory.

Other Explorer sections retain their existing capabilities: collections/views, validation, indexes, GridFS and statistics use their own native workflows. This change does not add replica-set or sharding administration, or permit direct editing of MongoDB's internal authorization collections.

A lost write response may mean the change was applied. Refresh and verify the inventory before retrying; DataPad++ does not automatically replay user/role writes.
