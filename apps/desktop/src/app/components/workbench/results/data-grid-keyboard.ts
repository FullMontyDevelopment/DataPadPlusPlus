import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export function isPlatformCopyShortcut(event: Pick<ReactKeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>) {
  if (event.key.toLowerCase() !== 'c' || event.altKey || event.shiftKey) {
    return false
  }

  return isApplePlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()

  return (
    target.isContentEditable ||
    target.contentEditable === 'true' ||
    target.getAttribute('contenteditable') === 'true' ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}

function isApplePlatform() {
  const platform =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? navigator.platform
      : ''

  return /\b(mac|iphone|ipad|ipod)\b/i.test(platform)
}
