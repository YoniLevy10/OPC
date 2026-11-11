'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AgentCreate } from '@/components/ops/agent-create'
import { AgentHistoryButton, AgentHistoryList } from '@/components/ops/agent-history'
import { AgentTurns } from '@/components/ops/agent-turn'
import { useAgentThreads } from '@/components/ops/use-agent-threads'
import type { AgentLink } from '@/modules/ops/agent-threads'
import { usePhrase } from '@/components/i18n/locale-provider'

export function RetainChat() {
  const p = usePhrase()
  const STARTERS = [
    p('איזה סניף הכי דחוף?'),
    p('כמה מחכה?'),
    p('מה כדאי לאחד?'),
  ]
  const { turns, setTurns, threads, activeId, ready, restore, startFresh } =
    useAgentThreads()
  const [history, setHistory] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const briefed = useRef(false)

  useEffect(() => {
    if (!ready || briefed.current) return
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
      .then((json: { reply?: string; error?: string }) => {
        if (json.reply) setTurns([{ role: 'assistant', text: json.reply }])
        else setError(json.error || 'העוזר לא הצליח לענות')
      })
      .catch(() => setError('אין קשר לעוזר כרגע'))
      .finally(() => setPending(false))
  }, [ready, turns.length, startFresh, setTurns])

  async function ask(text: string) {
    const message = text.trim()
    if (!message || pending) return
    const prior = turns.slice(-6)
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
        setError(json?.error || 'העוזר לא הצליח לענות')
        return
      }
      setTurns((current) => [
        ...current,
        { role: 'assistant', text: json.reply!, links: json.links },
      ])
    } catch {
      setError('אין קשר לעוזר כרגע')
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
      .then((json: { reply?: string; error?: string }) => {
        if (json.reply) setTurns([{ role: 'assistant', text: json.reply }])
        else setError(json.error || 'העוזר לא הצליח לענות')
      })
      .catch(() => setError('אין קשר לעוזר כרגע'))
      .finally(() => setPending(false))
  }

  return (
    <section
      aria-label={p('העוזר של ארי')}
      className="flex flex-col rounded-[var(--radius-lg)] border border-border bg-surface"
    >
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <p className="t-section text-ink">{p('העוזר של ארי')}</p>
          <p className="t-meta text-ink-3">{p('סניף דחוף והכסף שנרשם')}</p>
        </div>
        <AgentHistoryButton
          pressed={history}
          onClick={() => setHistory((value) => !value)}
        />
      </header>

      {history ? (
        <div className="border-t border-border">
          <AgentHistoryList
            threads={threads}
            activeId={activeId}
            onOpen={(id) => {
              restore(id)
              setHistory(false)
            }}
            onNew={beginNew}
          />
        </div>
      ) : (
        <div className="flex max-h-[22rem] min-h-[10rem] flex-col gap-2 overflow-y-auto border-t border-border px-4 py-3">
          {turns.length === 0 && !pending ? (
            <p className="t-body text-ink-2">
              {p('שאלו על סניף, על סכום שמחכה, או על איחוד ביקור.')}
            </p>
          ) : (
            <AgentTurns turns={turns} />
          )}
          {pending ? (
            <p className="t-meta text-ink-3">{p('מסתכל על הרשת…')}</p>
          ) : null}
          {error ? (
            <p className="t-meta text-[var(--signal-critical)]">{error}</p>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
        <AgentCreate disabled={pending} onCreate={(message) => void ask(message)} />
        {STARTERS.map((starter) => (
          <Button
            key={starter}
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => void ask(starter)}
          >
            {starter}
          </Button>
        ))}
      </div>
      <form
        className="flex gap-2 px-4 pb-4"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(draft)
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={p('שאלה על הסניף או על הכסף')}
          aria-label={p('שאלה על הסניף או על הכסף')}
          className="t-body h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-border bg-canvas px-3 text-ink"
        />
        <Button type="submit" size="sm" disabled={pending || !draft.trim()}>
          {p('שליחה')}
        </Button>
      </form>
    </section>
  )
}
