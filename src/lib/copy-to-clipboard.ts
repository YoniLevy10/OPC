/** Copy plain text to the clipboard. Returns false when Clipboard API is unavailable or rejects. */
export async function copyText(value: string): Promise<boolean> {
  const text = value.trim()
  if (!text) return false
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
