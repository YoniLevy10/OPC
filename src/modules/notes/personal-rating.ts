/** Shared personal rating + note encoding stored in `notes` text fields. */

const RATING_BLOCK =
  /(?:^|\n)\[דירוג אישי: ([1-5])\](?:\n([\s\S]*))?/

export function parsePersonalRating(notes: string | null | undefined): {
  rating: number
  note: string
} {
  const match = notes?.match(RATING_BLOCK)
  if (!match) {
    return { rating: 0, note: (notes ?? '').trim() }
  }
  return {
    rating: Number(match[1] ?? 0),
    note: (match[2] ?? '').trim(),
  }
}

export function formatPersonalRating(
  rating: number,
  note: string,
): string | null {
  const clean = note.trim()
  const stars = rating >= 1 && rating <= 5 ? rating : 0
  const text = `${stars ? `[דירוג אישי: ${stars}]\n` : ''}${clean}`.trim()
  return text || null
}
