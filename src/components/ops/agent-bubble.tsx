'use client'

import { usePhrase } from '@/components/i18n/locale-provider'
import { MessageSquare, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AgentHistoryButton, AgentHistoryList } from '@/components/ops/agent-history'
import { AgentTurns } from '@/components/ops/agent-turn'
import { useAgentThreads } from '@/components/ops/use-agent-threads'
import type { AgentLink } from '@/modules/ops/agent-threads'

const FAB_SIZE = 56
const FAB_MARGIN = 16
const DRAG_THRESHOLD = 8
const STORAGE_KEY = 'mos_agent_fab_pos'

type FabPos = { left: number; top: number }

function readCssPx(name: string): number {
  if (typeof window === 'undefined') return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

function defaultFabPos(): FabPos {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const isMd = vw >= 768
  if (isMd) {
    const navW = readCssPx('--nav-w') || 72
    return {
      left: Math.max(FAB_MARGIN, vw - navW - FAB_MARGIN - FAB_SIZE),
      top: Math.max(FAB_MARGIN, vh - FAB_MARGIN - FAB_SIZE),
    }
  }
  const bottomNav =
    readCssPx('--bottomnav-h') +
    readCssPx('--bottomnav-gap') +
    readCssPx('--safe-b') +
    12
  return {
    left: FAB_MARGIN,
    top: Math.max(FAB_MARGIN, vh - bottomNav - FAB_SIZE),
  }
}

function clampFabPos(pos: FabPos): FabPos {
  const maxLeft = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN)
  const maxTop = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN)
  return {
    left: Math.min(maxLeft, Math.max(FAB_MARGIN, pos.left)),
    top: Math.min(maxTop, Math.max(FAB_MARGIN, pos.top)),
  }
}

function loadFabPos(): FabPos | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FabPos>
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null
    return clampFabPos({ left: parsed.left, top: parsed.top })
  } catch {
    return null
  }
}

function saveFabPos(pos: FabPos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
  } catch {
    /* ignore quota / private mode */
  }
}

export function AgentBubble() {
  const p = usePhrase()
  const starters = [
    p('איזה סניף הכי דחוף?'),
    p('אילו הוצאות ממתינות?'),
    p('מה כדאי לאחד?'),
    p('מי בספר למיזוג אוויר?'),
    p('אילו מסמכים לחידוש?'),
  ]
  const { turns, setTurns, threads, activeId, ready, restore, startFresh } = useAgentThreads()
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<FabPos>({ left: FAB_MARGIN, top: FAB_MARGIN })
  const [dragging, setDragging] = useState(false)
  const briefed = useRef(false)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originLeft: number
    originTop: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    setPos(loadFabPos() ?? defaultFabPos())
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    function onResize() {
      setPos((current) => clampFabPos(current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mounted])

  useEffect(() => {
    if (!open || !ready || briefed.current) return
    briefed.current = true
    if (turns.length > 0) return
    startFresh()
    setPending(true)
    void fetch('/api/ops/agent-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'מה המצב?' }),
    })
      .then((res) => res.json())
      .then((json: { reply?: string }) => {
        if (json.reply) setTurns([{ role: 'assistant', text: json.reply }])
      })
      .catch(() => setError(p('אין קשר לסוכן כרגע')))
      .finally(() => setPending(false))
  }, [open, ready, turns.length, startFresh, setTurns, p])

  async function send(text: string) {
    const message = text.trim()
    if (!message || pending) return
    const prior = turns.slice(-14)
    setHistory(false)
    setTurns((current) => [...current, { role: 'user', text: message }])
    setDraft('')
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/ops/agent-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history: prior }),
      })
      const json = (await res.json().catch(() => null)) as {
        reply?: string
        links?: AgentLink[]
        error?: string
      } | null
      if (!res.ok || !json?.reply) {
        setError(p('העוזר לא הצליח לענות'))
        return
      }
      setTurns((current) => [...current, { role: 'assistant', text: json.reply!, links: json.links }])
    } catch {
      setError(p('אין קשר לסוכן כרגע'))
    } finally {
      setPending(false)
    }
  }

  function beginNew() {
    startFresh()
    setHistory(false)
    setError(null)
    setPending(true)
    void fetch('/api/ops/agent-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'מה המצב?' }),
    })
      .then((res) => res.json())
      .then((json: { reply?: string }) => {
        if (json.reply) setTurns([{ role: 'assistant', text: json.reply }])
      })
      .catch(() => setError(p('אין קשר לסוכן כרגע')))
      .finally(() => setPending(false))
  }

  function onFabPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: pos.left,
      originTop: pos.top,
      moved: false,
    }
  }

  function onFabPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    drag.moved = true
    suppressClickRef.current = true
    setDragging(true)
    setPos(
      clampFabPos({
        left: drag.originLeft + dx,
        top: drag.originTop + dy,
      }),
    )
  }

  function endFabDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.moved) {
      setPos((current) => {
        const next = clampFabPos(current)
        saveFabPos(next)
        return next
      })
    }
    dragRef.current = null
    setDragging(false)
  }

  if (!mounted) return null

  const nearRight = pos.left + FAB_SIZE / 2 > window.innerWidth / 2
  const nearTop = pos.top < window.innerHeight * 0.45

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div
        className="pointer-events-auto absolute"
        style={{ left: pos.left, top: pos.top, width: FAB_SIZE, height: FAB_SIZE }}
      >
        {open ? (
          <section
            role="dialog"
            aria-label={p('העוזר של ארי')}
            className={[
              'absolute flex h-[min(32rem,70dvh)] w-[min(22rem,calc(100dvw-2rem))] max-w-[calc(100dvw-2rem)] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-surface text-ink shadow-[var(--shadow-2)]',
              nearTop ? 'top-16' : 'bottom-16',
              nearRight ? 'right-0' : 'left-0',
            ].join(' ')}
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-medium">{p('העוזר של ארי')}</p>
              <div className="flex items-center">
                <AgentHistoryButton
                  pressed={history}
                  onClick={() => setHistory((value) => !value)}
                />
                <button
                  type="button"
                  aria-label={p('סגור')}
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-sunken"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </header>
            {history ? (
              <AgentHistoryList
                threads={threads}
                activeId={activeId}
                onOpen={(id) => {
                  restore(id)
                  setHistory(false)
                }}
                onNew={beginNew}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
                <AgentTurns turns={turns} compact />
                {pending ? (
                  <p className="text-xs text-ink-3">{p('מסתכל על הרשת…')}</p>
                ) : null}
                {error ? (
                  <p className="text-sm text-[var(--signal-critical)]">{error}</p>
                ) : null}
              </div>
            )}
            <div className="flex flex-nowrap gap-2 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  disabled={pending}
                  onClick={() => send(starter)}
                  className="shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs text-ink-2"
                >
                  {starter}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2 border-t border-border p-3"
              onSubmit={(event) => {
                event.preventDefault()
                void send(draft)
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={p('שאלה לארי')}
                aria-label={p('שאלה לסוכן')}
                className="min-w-0 flex-1 rounded-full border border-border bg-surface px-3 py-2 text-sm text-ink outline-none"
              />
              <button
                type="submit"
                disabled={pending || !draft.trim()}
                className="rounded-full bg-ink px-3 py-2 text-sm text-[var(--canvas)] disabled:opacity-40"
              >
                {p('שלח')}
              </button>
            </form>
          </section>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? p('סגור את הסוכן') : p('פתח את הסוכן')}
          title={p('גרור להזזה')}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            setOpen((value) => !value)
          }}
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={endFabDrag}
          onPointerCancel={endFabDrag}
          className={[
            'ops-agent-fab flex h-14 w-14 touch-none items-center justify-center rounded-full bg-ink text-[var(--canvas)]',
            dragging ? 'ops-agent-fab--dragging cursor-grabbing' : 'cursor-grab',
          ].join(' ')}
        >
          <MessageSquare className="h-6 w-6" aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  )
}
