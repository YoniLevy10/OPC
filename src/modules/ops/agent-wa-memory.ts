import type { ChatTurn } from '@/modules/ops/agent-chat'

const MAX_TURNS = 12
const turnsByWa = new Map<string, ChatTurn[]>()

/** Last N Ari WhatsApp turns for continuous context (in-process). */
export function recentAriWaTurns(waId: string, limit = 6): ChatTurn[] {
  const key = waId.trim()
  if (!key) return []
  return (turnsByWa.get(key) ?? []).slice(-Math.max(1, limit))
}

export function rememberAriWaTurn(waId: string, turn: ChatTurn): void {
  const key = waId.trim()
  if (!key || !turn.text.trim()) return
  const list = turnsByWa.get(key) ?? []
  list.push({ role: turn.role, text: turn.text.trim().slice(0, 800) })
  turnsByWa.set(key, list.slice(-MAX_TURNS))
}

export function rememberAriWaExchange(
  waId: string,
  userText: string,
  assistantText: string,
): void {
  rememberAriWaTurn(waId, { role: 'user', text: userText })
  rememberAriWaTurn(waId, { role: 'assistant', text: assistantText })
}

/** Test helper — clear in-memory WA chat rings. */
export function resetAriWaMemory(): void {
  turnsByWa.clear()
}
