export function confirmDestructiveAction(
  title: string,
  detail?: string,
  confirmFn: (message: string) => boolean = window.confirm.bind(window),
) {
  const message = [title, detail].filter(Boolean).join('\n\n')
  return confirmFn(message)
}
