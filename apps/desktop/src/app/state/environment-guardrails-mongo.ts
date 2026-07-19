export interface MongoScriptQueryRisk {
  looksWrite: boolean
  alwaysConfirmReason?: string
}

export function classifyMongoScriptRisk(script: string): MongoScriptQueryRisk {
  const executable = script
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ')
  const methods = [...executable.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((match) => match[1]?.toLowerCase())
    .filter((method): method is string => Boolean(method))
  const destructive = methods.some((method) => [
    'deleteone', 'deletemany', 'findoneanddelete', 'drop', 'dropindex',
    'dropindexes', 'dropdatabase', 'renamecollection',
  ].includes(method)) || /["']?\$(?:out|merge)["']?\s*:/.test(executable)
  const administrative = methods.some((method) => [
    'runcommand', 'admincommand', 'createindex', 'createindexes',
    'createcollection', 'dropindex', 'dropindexes', 'dropdatabase',
  ].includes(method))
  const write = destructive || administrative || methods.some((method) => [
    'insertone', 'insertmany', 'updateone', 'updatemany', 'replaceone',
    'findoneandupdate', 'findoneandreplace', 'bulkwrite', 'starttransaction',
    'committransaction', 'withtransaction',
  ].includes(method))

  return {
    looksWrite: write,
    alwaysConfirmReason: destructive
      ? 'MongoDB destructive script operations require confirmation before execution.'
      : administrative
        ? 'MongoDB administrative and server-command script operations require confirmation before execution.'
        : write
          ? 'MongoDB script write operations require confirmation before execution.'
          : undefined,
  }
}
