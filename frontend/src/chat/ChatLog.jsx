import { useCallback, useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../lib/motion'
import { buildMessages } from './messages'
import {
  BunnySays,
  PlayerSays,
  QuestionBubble,
  ReadyButton,
  SeenOnMount,
  SurfaceConfirm,
  TunnelPicker,
  Typing,
} from './parts'

// The conversation for the current layer. Messages appear one at a time:
// the transcript shows every seen message plus the first unseen one, which
// types itself out (or, for non-text messages, is marked seen right away).
// A message with a `delay` waits that long before appearing.
// Clicking the chat or pressing Space finishes the current message.
// Number keys pick answers (1-4) and tunnels (1-3); Escape cancels surfacing.
export default function ChatLog({ game, onTyping }) {
  const messages = buildMessages(game)
  const [seen, setSeen] = useState(() => new Set())
  const [released, setReleased] = useState(() => new Set())
  const [skipToken, setSkipToken] = useState(0)
  const endRef = useRef(null)

  const markSeen = useCallback((id) => setSeen((s) => (s.has(id) ? s : new Set(s).add(id))), [])

  const visible = []
  let held = null
  for (const m of messages) {
    if (!seen.has(m.id) && m.delay && !released.has(m.id)) {
      held = m
      break
    }
    visible.push(m)
    if (!seen.has(m.id)) break
  }
  const active = visible[visible.length - 1]
  const typing = Boolean(active && (active.kind === 'bunny' || active.kind === 'question') && !seen.has(active.id))
  const question = visible.find((m) => m.kind === 'question' && m.answerable && seen.has(m.id))
  const tunnels = visible.find((m) => m.kind === 'tunnels')

  // Release a held message after its delay.
  const heldId = held?.id
  const heldDelay = held?.delay
  useEffect(() => {
    if (!heldId) return undefined
    const t = setTimeout(() => setReleased((s) => new Set(s).add(heldId)), heldDelay)
    return () => clearTimeout(t)
  }, [heldId, heldDelay])

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [visible.length, active?.id, seen.size])

  useEffect(() => {
    if (!typing) onTyping?.(false)
  }, [typing, onTyping])

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return
      if (e.key === ' ' && typing && !e.target.closest?.('button')) {
        e.preventDefault()
        setSkipToken((t) => t + 1)
      } else if (e.key === 'Escape' && game.confirmingSurface) {
        game.cancelSurface()
      } else if (/^[1-4]$/.test(e.key) && !game.pending) {
        const n = Number(e.key) - 1
        if (question && n < question.options.length) game.answer(n)
        else if (tunnels && n < tunnels.tunnels.length) game.chooseTunnel(n)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const busy = Boolean(game.pending)

  return (
    <div
      className="chat__log"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      onClick={() => typing && setSkipToken((t) => t + 1)}
    >
      {visible.map((m, i) => {
        const done = () => markSeen(m.id)
        const first = i === 0 || !['bunny', 'question'].includes(visible[i - 1].kind)
        const typedProps = { m, first, seen: seen.has(m.id), skipToken, onTyping, onDone: done }
        if (m.kind === 'bunny') return <BunnySays key={m.id} {...typedProps} />
        if (m.kind === 'question') {
          return <QuestionBubble key={m.id} {...typedProps} onPick={game.answer} disabled={busy} />
        }
        let body = null
        if (m.kind === 'ready') body = <ReadyButton label={m.label} onClick={game.readyForQuestion} />
        if (m.kind === 'player') body = <PlayerSays m={m} />
        if (m.kind === 'typing') body = <Typing />
        if (m.kind === 'tunnels') body = <TunnelPicker tunnels={m.tunnels} onPick={game.chooseTunnel} disabled={busy} />
        if (m.kind === 'confirm')
          body = <SurfaceConfirm onYes={game.confirmSurface} onNo={game.cancelSurface} disabled={busy} />
        return (
          <SeenOnMount key={m.id} onDone={done}>
            {body}
          </SeenOnMount>
        )
      })}
      <div ref={endRef} className="chat__end" />
    </div>
  )
}
