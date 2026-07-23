export function setValueAtPath(
  document: Record<string, unknown>,
  path: Array<string | number>,
  nextValue: unknown,
) {
  const clone = clonePath(document, path.slice(0, -1))
  const parent = valueAtPath(clone, path.slice(0, -1))
  const key = path.at(-1)

  if (parent !== undefined && key !== undefined) {
    setChildValue(parent, key, nextValue)
  }

  return clone
}

export function renameFieldAtPath(
  document: Record<string, unknown>,
  parentPath: Array<string | number>,
  oldKey: string | number | undefined,
  nextName: string,
) {
  const clone = clonePath(document, parentPath)
  const parent = valueAtPath(clone, parentPath)

  if (!parent || oldKey === undefined || Array.isArray(parent)) {
    return clone
  }

  const record = parent as Record<string, unknown>
  record[nextName] = record[String(oldKey)]
  delete record[String(oldKey)]
  return clone
}

export function deleteValueAtPath(document: Record<string, unknown>, path: Array<string | number>) {
  const clone = clonePath(document, path.slice(0, -1))
  const parent = valueAtPath(clone, path.slice(0, -1))
  const key = path.at(-1)

  if (!parent || key === undefined) {
    return clone
  }

  if (Array.isArray(parent) && typeof key === 'number') {
    parent.splice(key, 1)
  } else {
    delete (parent as Record<string, unknown>)[String(key)]
  }

  return clone
}

function clonePath(
  document: Record<string, unknown>,
  path: Array<string | number>,
): Record<string, unknown> {
  const root = { ...document }
  let source: unknown = document
  let target: unknown = root

  for (const segment of path) {
    const sourceChild = childValue(source, segment)
    if (!isContainer(sourceChild) || !isContainer(target)) {
      break
    }

    const targetChild = Array.isArray(sourceChild)
      ? [...sourceChild]
      : { ...sourceChild }
    setChildValue(target, segment, targetChild)
    source = sourceChild
    target = targetChild
  }

  return root
}

function childValue(parent: unknown, key: string | number) {
  if (Array.isArray(parent) && typeof key === 'number') {
    return parent[key]
  }

  if (parent && typeof parent === 'object') {
    return (parent as Record<string, unknown>)[String(key)]
  }

  return undefined
}

function isContainer(value: unknown): value is Array<unknown> | Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function valueAtPath(value: unknown, path: Array<string | number>) {
  let current = value

  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined
    }

    if (Array.isArray(current)) {
      const index = arrayIndexFromPathKey(key)
      current = index === undefined ? undefined : current[index]
      continue
    }

    if (typeof current !== 'object') {
      return undefined
    }

    current = (current as Record<string, unknown>)[String(key)]
  }

  return current
}

function setChildValue(parent: unknown, key: string | number, nextValue: unknown) {
  if (Array.isArray(parent)) {
    const index = arrayIndexFromPathKey(key)
    if (index !== undefined) {
      parent[index] = nextValue
    }
    return
  }

  if (parent && typeof parent === 'object') {
    ;(parent as Record<string, unknown>)[String(key)] = nextValue
  }
}

function arrayIndexFromPathKey(key: string | number) {
  if (typeof key === 'number') {
    return Number.isInteger(key) && key >= 0 ? key : undefined
  }

  if (!/^\d+$/.test(key)) {
    return undefined
  }

  return Number(key)
}
