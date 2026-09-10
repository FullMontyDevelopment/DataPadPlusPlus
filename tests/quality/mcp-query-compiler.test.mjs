import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

test('committed query compiler and type-derived schemas are current', () => {
  execFileSync(process.execPath, ['tools/build-query-compiler.mjs', '--check'], { timeout: 60_000, stdio: 'pipe' })
})

test('frontend and sandbox agree across every executable builder family and typed predicates', async () => {
  const modules = ['mongo-find', 'mongo-aggregation', 'sql-select', 'cosmos-sql', 'cql-partition', 'search-dsl', 'dynamodb-key-condition']
  const built = await build({ stdin: { contents: modules.map(name => `export * from './packages/query-compiler/src/${name}.ts'`).join('\n'), resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' })
  const ui = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
  const context = vm.createContext({})
  new vm.Script(await readFile('apps/desktop/src-tauri/src/app/runtime/query_compiler.js', 'utf8')).runInContext(context)
  const compiler = context.DataPadQueryCompiler
  const vectors = [
    ['mongodb', ui.createDefaultMongoFindBuilderState('items', 20, 'catalog')],
    ['mongodb', ui.createDefaultMongoAggregationBuilderState('items', 20, 'catalog')],
    ['cosmosdb', ui.createDefaultCosmosSqlBuilderState('items', 'catalog')],
    ['dynamodb', ui.createDefaultDynamoDbKeyConditionBuilderState('items')],
    ['cassandra', ui.createDefaultCqlPartitionBuilderState('items', 'catalog')],
    ['elasticsearch', ui.createDefaultSearchDslBuilderState('items')],
    ['opensearch', ui.createDefaultSearchDslBuilderState('items')],
    ...['postgresql','mysql','mariadb','sqlserver','sqlite','cockroachdb','oracle'].map(engine => [engine, ui.createDefaultSqlSelectBuilderState('items')]),
  ]
  for (const [engine, state] of vectors) {
    const output = compiler.compileSavedBuilder({ builderState: state, connection: { engine } })
    assert.equal(output.ok, true, `${engine}/${state.kind}: ${JSON.stringify(output.errors)}`)
    assert.equal(output.queryText, compiler.compileQueryBuilderState(state, { engine }).queryText)
  }
  for (const type of ['number', 'date', 'uuid', 'objectId', 'boolean', 'json']) {
    const value = { number:'42', date:'2026-09-09T10:00:00Z', uuid:'123e4567-e89b-12d3-a456-426614174000', objectId:'507f1f77bcf86cd799439011', boolean:'true', json:'{"a":1}' }[type]
    const state = ui.createDefaultMongoFindBuilderState('items', 20, 'catalog')
    state.filters = [{ id:'typed', field:'value', operator:'eq', valueType:type, value, enabled:true }]
    const output = compiler.compileSavedBuilder({ builderState:state, connection:{engine:'mongodb'} })
    assert.equal(output.ok, true, `${type}: ${JSON.stringify(output.errors)}`)
    assert.equal(output.queryText, ui.buildMongoFindQueryText(state, {database:'catalog'}))
  }
})
test('compiler runs without browser/Node services and rejects stale invalid input', async () => {
  const context = vm.createContext({})
  new vm.Script(await readFile('apps/desktop/src-tauri/src/app/runtime/query_compiler.js', 'utf8')).runInContext(context, { timeout: 1000 })
  const compiler = context.DataPadQueryCompiler
  const state = { kind:'sql-select', table:'items', projectionFields:[], filters:[{id:'f1',field:'count',operator:'eq',valueType:'number',value:'42'}], filterLogic:'and',sort:[],limit:20 }
  for (const engine of ['postgresql','mysql','mariadb','sqlserver','sqlite','cockroachdb','oracle']) {
    const compiled = compiler.compileSavedBuilder({builderState:state,connection:{engine}})
    assert.equal(compiled.ok,true,engine)
    assert.equal(compiled.queryText,compiler.compileQueryBuilderState(state,{engine}).queryText)
  }
  const bad=compiler.compileSavedBuilder({builderState:{...state,lastAppliedQueryText:'select stale',filters:[{...state.filters[0],value:'NaN'}]},connection:{engine:'postgresql'}})
  assert.equal(bad.ok,false); assert.equal(bad.queryText,undefined)
  assert.equal(bad.errors[0].rowId,'f1')
})

test('shared builder regression vectors match the frontend compiler byte for byte', async () => {
  const built = await build({ entryPoints: ['packages/query-compiler/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
  const frontend = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
  const vectors = JSON.parse(await readFile('tests/fixtures/query-compiler-vectors.json', 'utf8'))
  assert.equal(vectors.length, 39)
  for (const vector of vectors) {
    const actual = frontend.compileSavedBuilder(vector.input)
    assert.equal(actual.ok, true, vector.name)
    assert.equal(actual.queryText, vector.queryText, vector.name)
  }
})
