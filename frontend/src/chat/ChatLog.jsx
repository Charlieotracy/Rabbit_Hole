import { useCallback, useEffect, useState } from 'react'
import { buildMessages } from './messages'
import { BunnySays, Enter, QuestionBubble, Typing } from './parts'

// The conversation for the current layer, anchored to the bunny at the
// bottom: the newest message sits right beside it and older ones slide up
// and fade. You can scroll up to re-read them.
//
// It's a column-reverse scroll box, so it starts (and stays) scrolled to the
// newest message and new content pushes older content upward. That's why
// messages are rendered newest-first.
//
// Messages appear one at a time: every seen message plus the first unseen
// one, which types itself out. Clicking the chat or pressing Space finishes
// the current message. Number keys pick answers (1-4) and tunnels (1-3);
// Escape cancels surfacing.
export default function ChatLog({ game, onTyping }) {
  const messages = buildMessages(game)
  const [seen, setSeen] = useState(() => new Set())
  const [skipToken, setSkipToken] = useState(0)

  const markSeen = useCallback((id) => setSeen((s) => (s.has(id) ? s : new Set(s).add(id))), [])

  const visible = []
  for (const m of messages) {
    visible.push(m)
    // Typing indicators never "finish", so they don't hold anything back.
    if (!seen.has(m.id) && m.kind !== 'typing') break
  }
  const active = visible[visible.length - 1]
  const typing = Boolean(active && active.kind !== 'typing' && !seen.has(active.id))
  const question = visible.find((m) => m.kind === 'question' && m.answerable && seen.has(m.id))
  const tunnelMsg = visible.find((m) => m.tunnels && seen.has(m.id) && m.chosenTunnel === null)

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
        else if (tunnelMsg && n < tunnelMsg.tunnels.length) game.chooseTunnel(n)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const busy = Boolean(game.pending)
  const last = visible.length - 1

  return (
    <div
      className="chat__log"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      onClick={() => typing && setSkipToken((t) => t + 1)}
    >
      {visible
        .map((m, i) => {
          // Age = how many messages came after this one; older ones fade more.
          const props = {
            m,
            newest: i === last,
            seen: seen.has(m.id),
            skipToken,
            onTyping,
            onDone: () => markSeen(m.id),
            game,
            busy,
          }
          let body
          if (m.kind === 'question') body = <QuestionBubble {...props} />
          else if (m.kind === 'typing') body = <Typing newest={i === last} note={m.note} />
          else body = <BunnySays {...props} />
          return (
            <div key={m.id} className="chat__item" style={{ '--age': last - i }}>
              <Enter>{body}</Enter>
            </div>
          )
        })
        .reverse()}
    </div>
  )
}
