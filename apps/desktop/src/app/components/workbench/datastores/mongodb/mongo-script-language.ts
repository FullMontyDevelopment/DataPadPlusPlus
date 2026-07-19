import type { EditorDiagnostic } from '../../DesktopCodeEditor.language-support'

export const MONGO_SCRIPT_DECLARATIONS = `
type MongoDocument = Record<string, unknown>;
type MongoFilter<T = MongoDocument> = Partial<T> & Record<string, unknown>;
type MongoUpdate = Record<string, unknown> | Array<Record<string, unknown>>;
type MongoOptions = Record<string, unknown>;
interface MongoCursor<T = MongoDocument> extends Iterable<T> {
  project(value: MongoDocument): this;
  projection(value: MongoDocument): this;
  sort(value: MongoDocument): this;
  skip(value: number): this;
  limit(value: number): this;
  hint(value: string | MongoDocument): this;
  collation(value: MongoDocument): this;
  comment(value: unknown): this;
  maxTimeMS(value: number): this;
  batchSize(value: number): this;
  allowDiskUse(value?: boolean): this;
  toArray(): T[];
  forEach(callback: (value: T, index: number) => void): void;
  map<U>(callback: (value: T, index: number) => U): U[];
  next(): T | null;
  tryNext(): T | null;
  hasNext(): boolean;
  explain(verbosity?: 'queryPlanner' | 'executionStats' | 'allPlansExecution'): MongoDocument;
}
interface MongoCollection<T = MongoDocument> {
  find(filter?: MongoFilter<T>, options?: MongoOptions): MongoCursor<T>;
  findOne(filter?: MongoFilter<T>, options?: MongoOptions): T | null;
  aggregate<TOut = MongoDocument>(pipeline?: MongoDocument[], options?: MongoOptions): MongoCursor<TOut>;
  countDocuments(filter?: MongoFilter<T>, options?: MongoOptions): number;
  estimatedDocumentCount(options?: MongoOptions): number;
  distinct(field: string, filter?: MongoFilter<T>, options?: MongoOptions): unknown[];
  insertOne(document: T, options?: MongoOptions): MongoDocument;
  insertMany(documents: T[], options?: MongoOptions): MongoDocument;
  updateOne(filter: MongoFilter<T>, update: MongoUpdate, options?: MongoOptions): MongoDocument;
  updateMany(filter: MongoFilter<T>, update: MongoUpdate, options?: MongoOptions): MongoDocument;
  replaceOne(filter: MongoFilter<T>, replacement: T, options?: MongoOptions): MongoDocument;
  deleteOne(filter: MongoFilter<T>, options?: MongoOptions): MongoDocument;
  deleteMany(filter: MongoFilter<T>, options?: MongoOptions): MongoDocument;
  findOneAndUpdate(filter: MongoFilter<T>, update: MongoUpdate, options?: MongoOptions): T | null;
  findOneAndReplace(filter: MongoFilter<T>, replacement: T, options?: MongoOptions): T | null;
  findOneAndDelete(filter: MongoFilter<T>, options?: MongoOptions): T | null;
  bulkWrite(models: MongoDocument[], options?: MongoOptions): MongoDocument;
  createIndex(keys: MongoDocument, options?: MongoOptions): MongoDocument;
  createIndexes(indexes: MongoDocument[], options?: MongoOptions): MongoDocument;
  getIndexes(options?: MongoOptions): MongoDocument[];
  dropIndex(name: string, options?: MongoOptions): MongoDocument;
  dropIndexes(options?: MongoOptions): MongoDocument;
  drop(options?: MongoOptions): MongoDocument;
  renameCollection(name: string, options?: MongoOptions): MongoDocument;
}
interface MongoSession {
  startTransaction(options?: MongoOptions): MongoDocument;
  commitTransaction(): MongoDocument;
  abortTransaction(): MongoDocument;
  endSession(): MongoDocument;
  withTransaction<T>(callback: (session: MongoSession) => T, options?: MongoOptions): T;
}
interface MongoDatabase {
  readonly [collection: string]: MongoCollection | unknown;
  getName(): string;
  getCollection<T = MongoDocument>(name: string): MongoCollection<T>;
  getSiblingDB(name: string): MongoDatabase;
  getCollectionNames(options?: MongoOptions): string[];
  runCommand(command: MongoDocument, options?: MongoOptions): MongoDocument;
  adminCommand(command: MongoDocument, options?: MongoOptions): MongoDocument;
  createCollection(name: string, options?: MongoOptions): MongoDocument;
  dropDatabase(options?: MongoOptions): MongoDocument;
  startSession(options?: MongoOptions): MongoSession;
  getMongo(): MongoDatabase;
}
declare const db: MongoDatabase;
declare function ObjectId(value?: string): { readonly $oid: string };
declare function UUID(value: string): { readonly $uuid: string };
declare function Binary(base64: string, subType?: string): { readonly $binary: { base64: string; subType: string } };
declare function Decimal128(value: string | number): { readonly $numberDecimal: string };
declare function NumberLong(value: string | number): { readonly $numberLong: string };
declare function Int32(value: string | number): { readonly $numberInt: string };
declare function Double(value: string | number): { readonly $numberDouble: string };
declare function ISODate(value?: string): { readonly $date: string };
declare function Timestamp(time: number, increment?: number): { readonly $timestamp: { t: number; i: number } };
declare function MinKey(): { readonly $minKey: 1 };
declare function MaxKey(): { readonly $maxKey: 1 };
declare const EJSON: { parse(text: string): unknown; stringify(value: unknown, replacer?: unknown, spaces?: number): string };
declare function print(...values: unknown[]): void;
declare function printjson(value: unknown): void;
declare const console: {
  log(...values: unknown[]): void;
  info(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
};
declare const require: never;
declare const fetch: never;
declare const WebSocket: never;
`

export function mongoScriptDiagnostics(source: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = []
  addMatches(diagnostics, source, /\b(?:eval|Function|require|load|fetch|WebSocket)\s*\(/g, 'Host APIs are unavailable in the MongoDB sandbox.')
  addMatches(diagnostics, source, /\bdb\s*\[\s*(?!["'])/g, 'Dynamic database property access cannot be authorized. Use db.getCollection("name").')
  addMatches(diagnostics, source, /\bObjectId\s*\(\s*["'](?![0-9a-fA-F]{24}["'])[^"']*["']\s*\)/g, 'ObjectId requires exactly 24 hexadecimal characters.')
  addMatches(diagnostics, source, /\bUUID\s*\(\s*["'](?![0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}["'])[^"']*["']\s*\)/g, 'UUID requires a canonical UUID string.')
  addMatches(diagnostics, source, /\b(?:pwd|password|credentials?)\s*:\s*["'](?!\{\{)[^"']+["']/gi, 'Use an environment secret placeholder instead of a credential literal.')
  return diagnostics
}

function addMatches(
  diagnostics: EditorDiagnostic[],
  source: string,
  pattern: RegExp,
  message: string,
) {
  for (const match of source.matchAll(pattern)) {
    diagnostics.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      message,
      severity: 'error',
    })
  }
}
