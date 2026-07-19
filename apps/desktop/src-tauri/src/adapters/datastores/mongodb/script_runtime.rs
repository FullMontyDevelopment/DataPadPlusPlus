use std::{
    cell::RefCell,
    rc::Rc,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use rquickjs::{CatchResultExt, Context, Function, Runtime, Value as JsValue};
use tokio_util::sync::CancellationToken;

use super::super::super::*;

const JAVASCRIPT_MEMORY_LIMIT: usize = 64 * 1024 * 1024;
const JAVASCRIPT_STACK_LIMIT: usize = 1024 * 1024;
const JAVASCRIPT_CPU_BUDGET: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub(super) struct JavaScriptExecution {
    pub(super) value: Value,
}

pub(super) fn execute_javascript<F>(
    source: &str,
    database: &str,
    cancellation: CancellationToken,
    call_host: F,
) -> Result<JavaScriptExecution, CommandError>
where
    F: FnMut(String) -> String + 'static,
{
    let runtime = Runtime::new().map_err(quickjs_runtime_error)?;
    runtime.set_memory_limit(JAVASCRIPT_MEMORY_LIMIT);
    runtime.set_max_stack_size(JAVASCRIPT_STACK_LIMIT);
    let started = Instant::now();
    let blocked_millis = Arc::new(AtomicU64::new(0));
    let interrupt_blocked_millis = Arc::clone(&blocked_millis);
    let interrupt_cancellation = cancellation;
    runtime.set_interrupt_handler(Some(Box::new(move || {
        let elapsed = started.elapsed();
        let blocked = Duration::from_millis(interrupt_blocked_millis.load(Ordering::Relaxed));
        interrupt_cancellation.is_cancelled()
            || elapsed.saturating_sub(blocked) >= JAVASCRIPT_CPU_BUDGET
    })));

    let context = Context::full(&runtime).map_err(quickjs_runtime_error)?;
    let host = Rc::new(RefCell::new(call_host));
    context.with(|ctx| {
        let callback_host = Rc::clone(&host);
        let callback_blocked = Arc::clone(&blocked_millis);
        let callback = Function::new(ctx.clone(), move |request: String| {
            let started = Instant::now();
            let response = (callback_host.borrow_mut())(request);
            callback_blocked.fetch_add(
                started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                Ordering::Relaxed,
            );
            response
        })
        .map_err(quickjs_runtime_error)?;
        ctx.globals()
            .set("__dpCall", callback)
            .map_err(quickjs_runtime_error)?;
        let bootstrap = bootstrap_for_database(database);
        ctx.eval::<(), _>(bootstrap.as_str())
            .catch(&ctx)
            .map_err(|error| quickjs_script_error(error.to_string()))?;

        let evaluated = ctx
            .eval::<JsValue<'_>, _>(source)
            .catch(&ctx)
            .map_err(|error| quickjs_script_error(error.to_string()))?;
        let evaluated = if let Some(promise) = evaluated.as_promise() {
            promise
                .finish::<JsValue<'_>>()
                .catch(&ctx)
                .map_err(|error| quickjs_script_error(error.to_string()))?
        } else {
            evaluated
        };
        ctx.globals()
            .set("__dpLastValue", evaluated)
            .map_err(quickjs_runtime_error)?;
        let output = ctx
            .eval::<String, _>("JSON.stringify(__dpFinalize(globalThis.__dpLastValue))")
            .catch(&ctx)
            .map_err(|error| quickjs_script_error(error.to_string()))?;
        let value = serde_json::from_str(&output).map_err(|error| {
            CommandError::new(
                "mongodb-script-result-invalid",
                format!("The MongoDB sandbox produced an invalid result: {error}"),
            )
        })?;
        Ok(JavaScriptExecution { value })
    })
}

fn quickjs_runtime_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        "mongodb-script-runtime",
        format!("The MongoDB JavaScript sandbox could not start: {error}"),
    )
}

fn quickjs_script_error(error: impl Into<String>) -> CommandError {
    let error = error.into();
    let lower = error.to_ascii_lowercase();
    if lower.contains("interrupted") {
        return CommandError::new(
            "mongodb-script-cpu-limit",
            "MongoDB script exceeded the 10-second JavaScript CPU budget.",
        );
    }
    if lower.contains("stack overflow") {
        return CommandError::new(
            "mongodb-script-stack-limit",
            "MongoDB script exceeded the 1 MiB JavaScript stack limit.",
        );
    }
    if lower.contains("out of memory") {
        return CommandError::new(
            "mongodb-script-memory-limit",
            "MongoDB script exceeded the 64 MiB JavaScript memory limit.",
        );
    }
    CommandError::new(
        "mongodb-script-execution",
        format!("MongoDB script failed inside the sandbox: {error}"),
    )
}

const MONGO_SCRIPT_BOOTSTRAP: &str = r#"
(() => {
  'use strict';
  const hostCall = __dpCall;
  try { delete globalThis.__dpCall; } catch (_) {}
  const invoke = (database, collection, method, args = [], options = {}) => {
    const response = JSON.parse(hostCall(JSON.stringify({ database, collection, method, args, options })));
    if (!response.ok) {
      const error = new Error(response.message || 'MongoDB operation failed.');
      error.code = response.code || 'mongodb-script-operation';
      throw error;
    }
    return response.value;
  };

  class MongoCursor {
    constructor(database, collection, method, args, options = {}) {
      this.database = database;
      this.collection = collection;
      this.method = method;
      this.args = args;
      this.options = { ...options };
      this.values = null;
      this.offset = 0;
      this.__datapadCursor = true;
    }
    _load() {
      if (this.values === null) this.values = invoke(this.database, this.collection, this.method, this.args, this.options);
      return this.values;
    }
    project(value) { this.options.projection = value; return this; }
    projection(value) { return this.project(value); }
    sort(value) { this.options.sort = value; return this; }
    skip(value) { this.options.skip = value; return this; }
    limit(value) { this.options.limit = value; return this; }
    hint(value) { this.options.hint = value; return this; }
    collation(value) { this.options.collation = value; return this; }
    comment(value) { this.options.comment = value; return this; }
    maxTimeMS(value) { this.options.maxTimeMS = value; return this; }
    batchSize(value) { this.options.batchSize = value; return this; }
    allowDiskUse(value = true) { this.options.allowDiskUse = value; return this; }
    toArray() { return this._load().slice(); }
    forEach(callback) { this._load().forEach(callback); }
    map(callback) { return this._load().map(callback); }
    hasNext() { return this.offset < this._load().length; }
    next() { return this.hasNext() ? this._load()[this.offset++] : null; }
    tryNext() { return this.next(); }
    explain(verbosity = 'queryPlanner') {
      return invoke(this.database, this.collection, this.method === 'aggregate' ? 'explainAggregate' : 'explainFind', this.args, { ...this.options, verbosity });
    }
    [Symbol.iterator]() { return this._load()[Symbol.iterator](); }
  }

  class MongoCollection {
    constructor(database, name) { this.database = database; this.name = String(name); }
    getName() { return this.name; }
    getFullName() { return `${this.database}.${this.name}`; }
    find(filter = {}, options = {}) { return new MongoCursor(this.database, this.name, 'find', [filter], options); }
    findOne(filter = {}, options = {}) { return invoke(this.database, this.name, 'findOne', [filter], options); }
    aggregate(pipeline = [], options = {}) { return new MongoCursor(this.database, this.name, 'aggregate', [pipeline], options); }
    countDocuments(filter = {}, options = {}) { return invoke(this.database, this.name, 'countDocuments', [filter], options); }
    estimatedDocumentCount(options = {}) { return invoke(this.database, this.name, 'estimatedDocumentCount', [], options); }
    distinct(field, filter = {}, options = {}) { return invoke(this.database, this.name, 'distinct', [field, filter], options); }
    insertOne(document, options = {}) { return invoke(this.database, this.name, 'insertOne', [document], options); }
    insertMany(documents, options = {}) { return invoke(this.database, this.name, 'insertMany', [documents], options); }
    updateOne(filter, update, options = {}) { return invoke(this.database, this.name, 'updateOne', [filter, update], options); }
    updateMany(filter, update, options = {}) { return invoke(this.database, this.name, 'updateMany', [filter, update], options); }
    replaceOne(filter, replacement, options = {}) { return invoke(this.database, this.name, 'replaceOne', [filter, replacement], options); }
    deleteOne(filter, options = {}) { return invoke(this.database, this.name, 'deleteOne', [filter], options); }
    deleteMany(filter, options = {}) { return invoke(this.database, this.name, 'deleteMany', [filter], options); }
    findOneAndUpdate(filter, update, options = {}) { return invoke(this.database, this.name, 'findOneAndUpdate', [filter, update], options); }
    findOneAndReplace(filter, replacement, options = {}) { return invoke(this.database, this.name, 'findOneAndReplace', [filter, replacement], options); }
    findOneAndDelete(filter, options = {}) { return invoke(this.database, this.name, 'findOneAndDelete', [filter], options); }
    bulkWrite(models, options = {}) { return invoke(this.database, this.name, 'bulkWrite', [models], options); }
    createIndex(keys, options = {}) { return invoke(this.database, this.name, 'createIndex', [keys], options); }
    createIndexes(indexes, options = {}) { return invoke(this.database, this.name, 'createIndexes', [indexes], options); }
    getIndexes(options = {}) { return invoke(this.database, this.name, 'getIndexes', [], options); }
    dropIndex(name, options = {}) { return invoke(this.database, this.name, 'dropIndex', [name], options); }
    dropIndexes(options = {}) { return invoke(this.database, this.name, 'dropIndexes', [], options); }
    drop(options = {}) { return invoke(this.database, this.name, 'dropCollection', [], options); }
    renameCollection(name, options = {}) { return invoke(this.database, this.name, 'renameCollection', [name], options); }
  }

  class MongoSession {
    startTransaction(options = {}) { return invoke(null, null, 'startTransaction', [], options); }
    commitTransaction() { return invoke(null, null, 'commitTransaction'); }
    abortTransaction() { return invoke(null, null, 'abortTransaction'); }
    endSession() { return invoke(null, null, 'endSession'); }
    withTransaction(callback, options = {}) {
      this.startTransaction(options);
      try {
        const result = callback(this);
        if (result && typeof result.then === 'function') {
          return result.then(
            (value) => { this.commitTransaction(); return value; },
            (error) => { this.abortTransaction(); throw error; },
          );
        }
        this.commitTransaction();
        return result;
      } catch (error) {
        this.abortTransaction();
        throw error;
      }
    }
  }

  class MongoDatabase {
    constructor(name) { this.name = String(name || 'test'); }
    getName() { return this.name; }
    getCollection(name) { return new MongoCollection(this.name, name); }
    getSiblingDB(name) { return createDatabase(name); }
    runCommand(command, options = {}) { return invoke(this.name, null, 'runCommand', [command], options); }
    adminCommand(command, options = {}) { return invoke('admin', null, 'adminCommand', [command], options); }
    createCollection(name, options = {}) { return invoke(this.name, null, 'createCollection', [name], options); }
    dropDatabase(options = {}) { return invoke(this.name, null, 'dropDatabase', [], options); }
    getCollectionNames(options = {}) { return invoke(this.name, null, 'getCollectionNames', [], options); }
    startSession(options = {}) { invoke(null, null, 'startSession', [], options); return new MongoSession(); }
    getMongo() { return this; }
  }

  const createDatabase = (name) => new Proxy(new MongoDatabase(name), {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || property in target) return Reflect.get(target, property, receiver);
      return target.getCollection(property);
    }
  });
  const scalar = (key, value) => Object.freeze({ [key]: value });
  const objectId = (value) => scalar('$oid', String(value ?? invoke(null, null, '__newObjectId')).toLowerCase());
  const uuid = (value) => scalar('$uuid', String(value));
  const binary = (value, subType = '00') => scalar('$binary', { base64: String(value), subType: String(subType).padStart(2, '0') });
  const decimal = (value) => scalar('$numberDecimal', String(value));
  const numberLong = (value) => scalar('$numberLong', String(value));
  const int32 = (value) => scalar('$numberInt', String(value));
  const double = (value) => scalar('$numberDouble', String(value));
  const isoDate = (value = new Date().toISOString()) => scalar('$date', String(value));
  const timestamp = (time, increment = 0) => scalar('$timestamp', { t: Number(time), i: Number(increment) });
  const minKey = () => scalar('$minKey', 1);
  const maxKey = () => scalar('$maxKey', 1);
  const printValue = (value, json = false) => invoke(null, null, '__console', [json ? JSON.stringify(value, null, 2) : String(value)]);

  Object.assign(globalThis, {
    db: createDatabase('__DATAPAD_DATABASE__'),
    ObjectId: objectId,
    UUID: uuid,
    Binary: binary,
    Decimal128: decimal,
    NumberLong: numberLong,
    Int32: int32,
    Double: double,
    ISODate: isoDate,
    Timestamp: timestamp,
    MinKey: minKey,
    MaxKey: maxKey,
    EJSON: { parse: JSON.parse, stringify: (value, _replacer, spaces) => JSON.stringify(value, null, spaces || 0) },
    print: (...values) => printValue(values.join(' ')),
    printjson: (value) => printValue(value, true),
    console: {
      log: (...values) => printValue(values.join(' ')),
      info: (...values) => printValue(values.join(' ')),
      warn: (...values) => printValue(values.join(' ')),
      error: (...values) => printValue(values.join(' ')),
    },
    __dpFinalize: (value) => value && value.__datapadCursor ? value.toArray() : (value === undefined ? null : value),
  });

  const blockedConstructor = function () { throw new Error('Dynamic code construction is unavailable in the MongoDB sandbox.'); };
  for (const prototype of [
    Function.prototype,
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ]) {
    try { Object.defineProperty(prototype, 'constructor', { value: blockedConstructor, writable: false, configurable: false }); } catch (_) {}
  }
  for (const name of ['eval', 'Function', 'require', 'import', 'load', 'fetch', 'WebSocket', 'XMLHttpRequest']) {
    try { Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false }); } catch (_) {}
  }
})();
"#;

pub(super) fn bootstrap_for_database(database: &str) -> String {
    MONGO_SCRIPT_BOOTSTRAP.replace(
        "__DATAPAD_DATABASE__",
        &database.replace('\\', "\\\\").replace('\'', "\\'"),
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/script_runtime_tests.rs"]
mod tests;
