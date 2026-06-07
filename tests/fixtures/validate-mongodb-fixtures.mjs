import { spawnSync } from 'node:child_process'

const checks = []

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    shell: false,
  })
}

function containerRunning(name) {
  const result = docker(['inspect', '-f', '{{.State.Running}}', name])
  return result.status === 0 && result.stdout.trim() === 'true'
}

function commandOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

function mongoEval(script, options = {}) {
  const result = docker([
    'exec',
    'datapadplusplus-mongodb',
    'mongosh',
    '--quiet',
    options.database ?? 'catalog',
    '--username',
    options.user ?? 'datapadplusplus',
    '--password',
    options.password ?? 'datapadplusplus',
    '--authenticationDatabase',
    options.authDb ?? 'admin',
    '--eval',
    script,
  ])

  if (result.status !== 0) {
    throw new Error(commandOutput(result))
  }

  return result.stdout.trim()
}

function mongoJson(script, options = {}) {
  const stdout = mongoEval(`
const __datapadFixtureResult = (() => {
${script}
})();
print(JSON.stringify({ __datapadFixtureResult }));
`, options)
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .reverse()
    .find((value) => value.startsWith('{"__datapadFixtureResult"'))

  if (!line) {
    throw new Error(`MongoDB fixture check did not print a JSON result. Output: ${stdout}`)
  }

  return JSON.parse(line).__datapadFixtureResult
}

async function record(name, action) {
  try {
    await action()
    checks.push({ name, ok: true })
  } catch (error) {
    checks.push({ name, ok: false, error })
  }
}

function expect(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function expectAtLeast(value, expected, label) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < expected) {
    throw new Error(`${label} expected at least ${expected}, got ${JSON.stringify(value)}`)
  }
}

function resetTransientMongoFixtures() {
  mongoEval(`
const catalog = db.getSiblingDB('catalog');
for (const name of [
  'fixture_mongodb_import_export',
  'fixture_mongodb_import_export_failures',
  'fixture_mongodb_management'
]) {
  try {
    catalog.getCollection(name).drop();
  } catch (error) {}
}
for (const user of ['fixture_mongodb_readonly', 'fixture_mongodb_management_user']) {
  try {
    catalog.dropUser(user);
  } catch (error) {}
}
`)
}

if (!containerRunning('datapadplusplus-mongodb')) {
  throw new Error('MongoDB fixture is not running. Run `npm run fixtures:up && npm run fixtures:seed` first.')
}

resetTransientMongoFixtures()

await record('MongoDB: seeded catalog and large collections', () => {
  const result = mongoJson(`
const catalog = db.getSiblingDB('catalog');
const largeSample = catalog.largeDocuments.find({}, { projection: { sections: { $slice: 2 } } }).limit(2).toArray();
return {
  products: catalog.products.estimatedDocumentCount(),
  accounts: catalog.accounts.estimatedDocumentCount(),
  orders: catalog.orders.estimatedDocumentCount(),
  perfDocuments: catalog.perfDocuments.estimatedDocumentCount(),
  largeDocuments: catalog.largeDocuments.estimatedDocumentCount(),
  productIndexes: catalog.products.getIndexes().map((index) => index.name),
  largeSampleBytes: EJSON.stringify(largeSample).length,
};
`)

  expectAtLeast(result.products, 1000, 'MongoDB products')
  expectAtLeast(result.accounts, 499, 'MongoDB accounts')
  expectAtLeast(result.orders, 25000, 'MongoDB orders')
  expectAtLeast(result.perfDocuments, 150000, 'MongoDB perfDocuments')
  expectAtLeast(result.largeDocuments, 12, 'MongoDB largeDocuments')
  expect(result.productIndexes.includes('sku_1'), 'MongoDB products unique sku index is missing')
  expectAtLeast(result.largeSampleBytes, 100000, 'MongoDB large sample payload bytes')
})

await record('MongoDB: collection export/import primitives', () => {
  const result = mongoJson(`
const catalog = db.getSiblingDB('catalog');
const collection = catalog.fixture_mongodb_import_export;
collection.drop();
collection.insertMany([
  {
    _id: 'export-1',
    sku: 'fixture-export-1',
    nested: { qty: 3, tags: ['blue', 'fragile'] },
    createdAt: new Date('2026-01-01T00:00:00Z')
  },
  {
    _id: 'export-2',
    sku: 'fixture-export-2',
    nested: { qty: 7, tags: ['green'] },
    createdAt: new Date('2026-01-01T00:01:00Z')
  }
]);
const exported = collection
  .find({ sku: /^fixture-export-/ }, { sku: 1, nested: 1 })
  .sort({ sku: 1 })
  .limit(2)
  .toArray();
const beforeCount = collection.countDocuments();
collection.insertMany([
  { _id: 'import-1', sku: 'fixture-import-1', amount: NumberDecimal('12.40') },
  { _id: 'import-2', sku: 'fixture-import-2', amount: NumberDecimal('18.90') }
], { ordered: false });
return {
  exportedCount: exported.length,
  exportedFirstSku: exported[0]?.sku,
  beforeCount,
  afterCount: collection.countDocuments(),
  importedCount: collection.countDocuments({ sku: /^fixture-import-/ }),
};
`)

  expect(result.exportedCount === 2, 'MongoDB export primitive did not return two documents')
  expect(result.exportedFirstSku === 'fixture-export-1', 'MongoDB export primitive did not preserve sort')
  expect(result.beforeCount === 2, 'MongoDB import primitive had an unexpected before count')
  expect(result.afterCount === 4, 'MongoDB import primitive had an unexpected after count')
  expect(result.importedCount === 2, 'MongoDB import primitive did not write both documents')
})

await record('MongoDB: duplicate-key and validator failure evidence', () => {
  const result = mongoJson(`
const catalog = db.getSiblingDB('catalog');
const name = 'fixture_mongodb_import_export_failures';
catalog.getCollection(name).drop();
catalog.createCollection(name, {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['sku'],
      properties: {
        sku: { bsonType: 'string' }
      }
    }
  }
});
const collection = catalog.getCollection(name);
collection.createIndex({ sku: 1 }, { unique: true, name: 'fixture_unique_sku' });
collection.insertOne({ _id: 'dup-1', sku: 'duplicate-sku' });

let duplicateDenied = false;
let duplicateMessage = '';
try {
  collection.insertMany([
    { _id: 'dup-1', sku: 'duplicate-sku-again' },
    { _id: 'dup-2', sku: 'after-duplicate' }
  ], { ordered: true });
} catch (error) {
  duplicateDenied = error.code === 11000 || /duplicate key/i.test(error.message);
  duplicateMessage = error.message;
}
const afterDuplicateCount = collection.countDocuments();

const candidates = [
  { _id: 'dup-1', sku: 'duplicate-sku' },
  { _id: 'skip-new', sku: 'skip-new-sku' }
];
const existingIds = new Set(collection
  .find({ _id: { $in: candidates.map((item) => item._id) } }, { projection: { _id: 1 } })
  .toArray()
  .map((item) => String(item._id)));
const toInsert = candidates.filter((item) => !existingIds.has(String(item._id)));
if (toInsert.length > 0) {
  collection.insertMany(toInsert, { ordered: false });
}

let validatorDenied = false;
let validatorMessage = '';
try {
  collection.insertOne({ _id: 'invalid-1', quantity: 3 });
} catch (error) {
  validatorDenied = error.code === 121 || /validation/i.test(error.message);
  validatorMessage = error.message;
}

return {
  duplicateDenied,
  duplicateMessage,
  afterDuplicateCount,
  skippedDuplicates: candidates.length - toInsert.length,
  insertedAfterSkip: toInsert.length,
  validatorDenied,
  validatorMessage,
  finalCount: collection.countDocuments(),
};
`)

  expect(result.duplicateDenied, `MongoDB duplicate-key failure was not observed: ${result.duplicateMessage}`)
  expect(result.afterDuplicateCount === 1, 'MongoDB ordered duplicate failure mutated extra documents')
  expect(result.skippedDuplicates === 1, 'MongoDB duplicate skip precheck did not detect the existing id')
  expect(result.insertedAfterSkip === 1, 'MongoDB duplicate skip precheck did not keep the new document')
  expect(result.validatorDenied, `MongoDB validator failure was not observed: ${result.validatorMessage}`)
  expect(result.finalCount === 2, 'MongoDB validator failure mutated the collection')
})

await record('MongoDB: permission-specific diagnostics denial evidence', () => {
  mongoEval(`
const catalog = db.getSiblingDB('catalog');
try {
  catalog.dropUser('fixture_mongodb_readonly');
} catch (error) {}
catalog.createUser({
  user: 'fixture_mongodb_readonly',
  pwd: 'datapad-readonly-fixture',
  roles: [{ role: 'read', db: 'catalog' }]
});
`)

  try {
    const result = mongoJson(`
const catalog = db.getSiblingDB('catalog');
const canRead = Boolean(catalog.products.findOne({ sku: 'luna-lamp' }));
const dbStatsOk = catalog.runCommand({ dbStats: 1, scale: 1 }).ok === 1;

let writeDenied = false;
let writeMessage = '';
try {
  catalog.products.insertOne({ _id: 'fixture-readonly-denied', sku: 'readonly-denied' });
} catch (error) {
  writeDenied = error.code === 13 || /not authorized|unauthorized/i.test(error.message);
  writeMessage = error.message;
}

let serverStatusDenied = false;
let serverStatusMessage = '';
try {
  db.getSiblingDB('admin').runCommand({ serverStatus: 1 });
} catch (error) {
  serverStatusDenied = error.code === 13 || /not authorized|unauthorized/i.test(error.message);
  serverStatusMessage = error.message;
}

let currentOpDenied = false;
let currentOpMessage = '';
try {
  db.getSiblingDB('admin').runCommand({ currentOp: 1, $all: true });
} catch (error) {
  currentOpDenied = error.code === 13 || /not authorized|unauthorized/i.test(error.message);
  currentOpMessage = error.message;
}

return {
  canRead,
  dbStatsOk,
  writeDenied,
  writeMessage,
  serverStatusDenied,
  serverStatusMessage,
  currentOpDenied,
  currentOpMessage,
};
`, {
      user: 'fixture_mongodb_readonly',
      password: 'datapad-readonly-fixture',
      authDb: 'catalog',
    })

    expect(result.canRead, 'MongoDB readonly fixture user could not read seeded products')
    expect(result.dbStatsOk, 'MongoDB readonly fixture user could not run database diagnostics')
    expect(result.writeDenied, `MongoDB readonly fixture user was not denied writes: ${result.writeMessage}`)
    expect(
      result.serverStatusDenied,
      `MongoDB readonly fixture user was not denied serverStatus: ${result.serverStatusMessage}`,
    )
    expect(result.currentOpDenied, `MongoDB readonly fixture user was not denied currentOp: ${result.currentOpMessage}`)
  } finally {
    mongoEval(`
const catalog = db.getSiblingDB('catalog');
try {
  catalog.dropUser('fixture_mongodb_readonly');
} catch (error) {}
`)
  }
})

await record('MongoDB: management before/after evidence', () => {
  const result = mongoJson(`
const catalog = db.getSiblingDB('catalog');
const name = 'fixture_mongodb_management';
catalog.getCollection(name).drop();
catalog.createCollection(name);
const collection = catalog.getCollection(name);
collection.insertMany([
  { _id: 'mgmt-1', sku: 'mgmt-1', active: true },
  { _id: 'mgmt-2', sku: 'mgmt-2', active: false }
]);

const beforeIndexCount = collection.getIndexes().length;
collection.createIndex({ sku: 1 }, { name: 'fixture_mgmt_sku' });
catalog.runCommand({ collMod: name, index: { name: 'fixture_mgmt_sku', hidden: true } });
const hiddenAfterHide = collection.getIndexes().find((index) => index.name === 'fixture_mgmt_sku')?.hidden === true;
catalog.runCommand({ collMod: name, index: { name: 'fixture_mgmt_sku', hidden: false } });
const hiddenAfterUnhide = collection.getIndexes().find((index) => index.name === 'fixture_mgmt_sku')?.hidden === true;
const afterIndexCount = collection.getIndexes().length;

const beforeValidator = catalog.getCollectionInfos({ name })[0]?.options?.validator ?? null;
catalog.runCommand({
  collMod: name,
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['sku'],
      properties: {
        sku: { bsonType: 'string' }
      }
    }
  }
});
const afterValidator = catalog.getCollectionInfos({ name })[0]?.options?.validator ?? null;

try {
  catalog.dropUser('fixture_mongodb_management_user');
} catch (error) {}
const usersBefore = catalog.getUsers().users.length;
catalog.createUser({
  user: 'fixture_mongodb_management_user',
  pwd: 'datapad-management-fixture',
  roles: [{ role: 'read', db: 'catalog' }]
});
const usersAfterCreate = catalog.getUsers().users.length;
catalog.dropUser('fixture_mongodb_management_user');
const usersAfterDrop = catalog.getUsers().users.length;

return {
  beforeIndexCount,
  afterIndexCount,
  hiddenAfterHide,
  hiddenAfterUnhide,
  beforeValidator,
  afterValidatorRequired: afterValidator?.$jsonSchema?.required ?? [],
  usersBefore,
  usersAfterCreate,
  usersAfterDrop,
};
`)

  expect(result.afterIndexCount === result.beforeIndexCount + 1, 'MongoDB management index count did not increase')
  expect(result.hiddenAfterHide, 'MongoDB management index hide was not reflected')
  expect(!result.hiddenAfterUnhide, 'MongoDB management index unhide was not reflected')
  expect(result.beforeValidator === null, 'MongoDB management collection started with an unexpected validator')
  expect(
    Array.isArray(result.afterValidatorRequired) && result.afterValidatorRequired.includes('sku'),
    'MongoDB management validator update was not reflected',
  )
  expect(result.usersAfterCreate === result.usersBefore + 1, 'MongoDB management user create did not change user count')
  expect(result.usersAfterDrop === result.usersBefore, 'MongoDB management user drop did not restore user count')
})

resetTransientMongoFixtures()

const failures = checks.filter((check) => !check.ok)

for (const check of checks) {
  if (check.ok) {
    console.log(`ok - ${check.name}`)
  } else {
    console.error(`not ok - ${check.name}`)
    console.error(check.error.message)
  }
}

if (failures.length > 0) {
  process.exitCode = 1
}
