export type MongoScriptRisk =
  | 'read'
  | 'write'
  | 'destructive'
  | 'administrative'

export interface MongoScriptCatalogEntry {
  section: MongoScriptSection
  name: string
  signature: string
  summary: string
  risk: MongoScriptRisk
  example(database: string, collection: string): string
}

export type MongoScriptSection =
  | 'Query'
  | 'CRUD'
  | 'Aggregation'
  | 'Bulk'
  | 'Transactions'
  | 'Indexes'
  | 'Administration'
  | 'BSON'
  | 'Output'
  | 'Safety'

const fixed = (value: string) => () => value

export const MONGO_SCRIPT_SECTIONS: MongoScriptSection[] = [
  'Query',
  'CRUD',
  'Aggregation',
  'Bulk',
  'Transactions',
  'Indexes',
  'Administration',
  'BSON',
  'Output',
  'Safety',
]

export const MONGO_SCRIPT_CATALOG: MongoScriptCatalogEntry[] = [
  entry('Query', 'find', 'collection.find(filter, options)', 'Build a lazy cursor and chain projection, sorting, paging, hints, collation, comments, or maxTimeMS.', 'read', (_database, collection) => `db.getCollection(${quote(collection)}).find({ status: "active" }).sort({ updatedAt: -1 }).limit(20)`),
  entry('Query', 'findOne', 'collection.findOne(filter, options)', 'Return the first matching document.', 'read', (_database, collection) => `db.getCollection(${quote(collection)}).findOne({ _id: ObjectId("000000000000000000000000") })`),
  entry('Query', 'countDocuments', 'collection.countDocuments(filter, options)', 'Count documents matching a filter.', 'read', (_database, collection) => `db.getCollection(${quote(collection)}).countDocuments({ status: "active" })`),
  entry('Query', 'distinct', 'collection.distinct(field, filter)', 'Return distinct values for a field.', 'read', (_database, collection) => `db.getCollection(${quote(collection)}).distinct("status", {})`),
  entry('Aggregation', 'aggregate', 'collection.aggregate(pipeline, options)', 'Run a bounded aggregation pipeline. Pipelines containing $out or $merge are mutations.', 'read', (_database, collection) => `db.getCollection(${quote(collection)}).aggregate([\n  { $match: { status: "active" } },\n  { $group: { _id: "$category", count: { $sum: 1 } } },\n  { $sort: { count: -1 } }\n]).toArray()`),
  entry('CRUD', 'insertOne', 'collection.insertOne(document, options)', 'Insert one document and return its identifier.', 'write', (_database, collection) => `db.getCollection(${quote(collection)}).insertOne({\n  name: "New item",\n  createdAt: ISODate()\n})`),
  entry('CRUD', 'insertMany', 'collection.insertMany(documents, options)', 'Insert an ordered or unordered document batch.', 'write', (_database, collection) => `db.getCollection(${quote(collection)}).insertMany([\n  { name: "First" },\n  { name: "Second" }\n], { ordered: true })`),
  entry('CRUD', 'updateOne', 'collection.updateOne(filter, update, options)', 'Update the first matching document.', 'write', (_database, collection) => `db.getCollection(${quote(collection)}).updateOne(\n  { status: "pending" },\n  { $set: { status: "active", updatedAt: ISODate() } }\n)`),
  entry('CRUD', 'updateMany', 'collection.updateMany(filter, update, options)', 'Update all matching documents.', 'write', (_database, collection) => `db.getCollection(${quote(collection)}).updateMany(\n  { archived: true },\n  { $set: { visible: false } }\n)`),
  entry('CRUD', 'replaceOne', 'collection.replaceOne(filter, replacement, options)', 'Replace one matching document.', 'write', (_database, collection) => `db.getCollection(${quote(collection)}).replaceOne(\n  { _id: ObjectId("000000000000000000000000") },\n  { name: "Replacement", updatedAt: ISODate() }\n)`),
  entry('CRUD', 'deleteOne', 'collection.deleteOne(filter, options)', 'Delete the first matching document.', 'destructive', (_database, collection) => `db.getCollection(${quote(collection)}).deleteOne({ _id: ObjectId("000000000000000000000000") })`),
  entry('CRUD', 'deleteMany', 'collection.deleteMany(filter, options)', 'Delete all documents matching a non-empty filter.', 'destructive', (_database, collection) => `db.getCollection(${quote(collection)}).deleteMany({ expiresAt: { $lt: ISODate() } })`),
  entry('CRUD', 'findOneAndUpdate', 'collection.findOneAndUpdate(filter, update, options)', 'Atomically update and return a document.', 'write', (_database, collection) => `db.getCollection(${quote(collection)}).findOneAndUpdate(\n  { status: "pending" },\n  { $set: { status: "active" } },\n  { returnDocument: "after" }\n)`),
  entry('CRUD', 'findOneAndDelete', 'collection.findOneAndDelete(filter, options)', 'Atomically delete and return one matching document.', 'destructive', (_database, collection) => `db.getCollection(${quote(collection)}).findOneAndDelete({ expired: true })`),
  entry('CRUD', 'findOneAndReplace', 'collection.findOneAndReplace(filter, replacement, options)', 'Atomically replace and return one matching document.', 'write', (_database, collection) => `db.getCollection(${quote(collection)}).findOneAndReplace(\n  { _id: ObjectId("000000000000000000000000") },\n  { name: "Replacement", updatedAt: ISODate() },\n  { returnDocument: "after" }\n)`),
  entry('Bulk', 'bulkWrite', 'collection.bulkWrite(models, options)', 'Execute ordered or unordered insert, update, replace, and delete models.', 'write', (_database, collection) => `db.getCollection(${quote(collection)}).bulkWrite([\n  { insertOne: { document: { name: "New item" } } },\n  { updateOne: { filter: { status: "pending" }, update: { $set: { status: "active" } } } }\n], { ordered: true })`),
  entry('Transactions', 'withTransaction', 'session.withTransaction(callback)', 'Commit the callback on success and abort it on an uncaught error.', 'write', (_database, collection) => `const session = db.startSession()\ntry {\n  await session.withTransaction(async () => {\n    db.getCollection(${quote(collection)}).updateOne(\n      { status: "pending" },\n      { $set: { status: "active" } }\n    )\n  })\n} finally {\n  session.endSession()\n}`),
  entry('Indexes', 'createIndex', 'collection.createIndex(keys, options)', 'Create an index and return its name.', 'administrative', (_database, collection) => `db.getCollection(${quote(collection)}).createIndex({ status: 1, updatedAt: -1 }, { name: "status_updated" })`),
  entry('Indexes', 'createIndexes', 'collection.createIndexes(models)', 'Create several named or automatically named indexes.', 'administrative', (_database, collection) => `db.getCollection(${quote(collection)}).createIndexes([\n  { key: { status: 1 }, name: "status_1" },\n  { key: { updatedAt: -1 }, name: "updated_desc" }\n])`),
  entry('Indexes', 'getIndexes', 'collection.getIndexes()', 'List indexes visible to the authenticated user.', 'read', (_database, collection) => `db.getCollection(${quote(collection)}).getIndexes()`),
  entry('Indexes', 'dropIndex', 'collection.dropIndex(name)', 'Drop one index.', 'destructive', (_database, collection) => `db.getCollection(${quote(collection)}).dropIndex("status_updated")`),
  entry('Indexes', 'dropIndexes', 'collection.dropIndexes()', 'Drop every non-_id index on a collection.', 'destructive', (_database, collection) => `db.getCollection(${quote(collection)}).dropIndexes()`),
  entry('Administration', 'runCommand', 'db.runCommand(command)', 'Run a database command. Unknown and mutating commands require confirmation.', 'administrative', fixed('db.runCommand({ ping: 1 })')),
  entry('Administration', 'adminCommand', 'db.adminCommand(command)', 'Run a command against the admin database when the account has permission.', 'administrative', fixed('db.adminCommand({ serverStatus: 1 })')),
  entry('Administration', 'createCollection', 'db.createCollection(name, options)', 'Create a collection with optional validation settings.', 'administrative', fixed('db.createCollection("events", { validator: { type: { $type: "string" } } })')),
  entry('Administration', 'renameCollection', 'collection.renameCollection(name, options)', 'Rename a collection in the active database.', 'destructive', (_database, collection) => `db.getCollection(${quote(collection)}).renameCollection(${quote(`${collection}_renamed`)})`),
  entry('Administration', 'drop collection', 'collection.drop()', 'Drop the active collection and its indexes.', 'destructive', (_database, collection) => `db.getCollection(${quote(collection)}).drop()`),
  entry('BSON', 'BSON constructors', 'ObjectId, UUID, Binary, Decimal128, NumberLong, Int32, Double, ISODate, Timestamp', 'Create Extended JSON values that round-trip through the native MongoDB driver.', 'read', fixed('const id = ObjectId("000000000000000000000000")\nconst correlationId = UUID("00000000-0000-0000-0000-000000000000")\nconst createdAt = ISODate()')),
  entry('Output', 'print', 'print(...values)', 'Write plain text progress and debugging messages. Output appears in Messages and Raw results.', 'read', fixed('print("Starting product scan")\nconst count = db.products.countDocuments({})\nprint("Products found:", count)')),
  entry('Output', 'printjson', 'printjson(value)', 'Write bounded Extended JSON output to Messages and Raw results.', 'read', (_database, collection) => `const document = db.getCollection(${quote(collection)}).findOne({})\nprintjson(document)`),
  entry('Output', 'console logging', 'console.log(...values)', 'Log plain text with console.log, console.info, console.warn, or console.error.', 'read', fixed('console.log("Connected to", db.getName())\nconsole.info("Running read-only checks")')),
  entry('Safety', 'environment secrets', '{{SECRET_NAME}}', 'Reference secrets through environment placeholders. Credential literals in user and role commands are rejected.', 'read', fixed('db.runCommand({ authenticate: 1, user: "{{MONGO_USER}}", pwd: "{{MONGO_PASSWORD}}" })')),
]

function entry(
  section: MongoScriptSection,
  name: string,
  signature: string,
  summary: string,
  risk: MongoScriptRisk,
  example: MongoScriptCatalogEntry['example'],
): MongoScriptCatalogEntry {
  return { section, name, signature, summary, risk, example }
}

function quote(value: string) {
  return JSON.stringify(value || 'collection')
}
