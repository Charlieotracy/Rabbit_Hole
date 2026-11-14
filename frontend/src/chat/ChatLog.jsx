import { useCallback, useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../lib/motion'
import { buildMessages } from './messages'
import {
  ArtifactCard,
  BunnySays,
  DigBurst,
  PlayerSays,
  ReplyChips,
  SeenOnMount,
  SurfaceConfirm,
  TunnelPicker,
  Typing,
} from './parts'

// The conversation for the current layer. Messages appear one at a time:
// the transcript shows every seen message plus the first unseen one, which
// types itself out (or, for non-text messages, is marked seen right away).
// Clicking the chat or pressing Space finishes the current message.
// Number keys pick answers (1-4) and tunnels (1-3); Escape cancels surfacing.
export default function ChatLog({ game, onTyping }) {
  const messages = buildMessages(game)
  const [seen, setSeen] = useState(() => new Set())
  const [skipToken, setSkipToken] = useState(0)
  const endRef = useRef(null)

  const markSeen = useCallback((id) => setSeen((s) => (s.has(id) ? s : new Set(s).add(id))), [])

  const visible = []
  for (const m of messages) {
    visible.push(m)
    if (!seen.has(m.id)) break
  }
  const active = visible[visible.length - 1]
  const typing = Boolean(active && active.kind === 'bunny' && !seen.has(active.id))
  const replies = visible.find((m) => m.kind === 'replies')
  const tunnels = visible.find((m) => m.kind === 'tunnels')

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
        if (replies && n < replies.options.length) game.answer(n)
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
        if (m.kind === 'bunny') {
          const first = i === 0 || visible[i - 1].kind !== 'bunny'
          return (
            <BunnySays
              key={m.id}
              m={m}
              first={first}
              seen={seen.has(m.id)}
              skipToken={skipToken}
              onTyping={onTyping}
              onDone={done}
            />
          )
        }
        let body = null
        if (m.kind === 'player') body = <PlayerSays m={m} />
        if (m.kind === 'replies') body = <ReplyChips options={m.options} onPick={game.answer} disabled={busy} />
        if (m.kind === 'typing') body = <Typing digging={m.digging} />
        if (m.kind === 'dig') body = <DigBurst />
        if (m.kind === 'artifact') body = <ArtifactCard artifact={m.artifact} />
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
