export function documentCountText(summary: string | undefined, fallbackCount: number) {
  const count = fallbackCount || Number(summary?.match(/^\s*(\d+)/)?.[1] ?? 0)
  return `${count} document(s) loaded`
}
