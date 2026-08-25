/**
 * `navigator.clipboard` is withheld outside a secure context, and ADR 0003
 * commits this app to serving over plain HTTP off-printer — so the async
 * Clipboard API silently doesn't exist for most real deployments. Falls back
 * to the deprecated `execCommand('copy')` path via an off-screen textarea,
 * which copies regardless of secure context. Returns whether the copy
 * succeeded so the caller can decide how to report failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the execCommand path below.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()

  let succeeded: boolean
  try {
    succeeded = document.execCommand('copy')
  } catch {
    succeeded = false
  }

  document.body.removeChild(textarea)
  return succeeded
}
