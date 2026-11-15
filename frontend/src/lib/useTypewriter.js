import { useCallback, useEffect, useState } from 'react'
import { reducedMotion } from './motion'

const TICK_MS = 22 // ~45 characters per second when it's keeping pace
const CATCH_UP = 30 // bigger backlogs type proportionally faster

// Reveals `text` a character at a time, like the bunny is typing.
//
// The text may keep growing while it streams in from the backend: the typing
// carries on from where it was instead of restarting, speeding up when it
// falls behind so chunky streams still look smooth. Pass `streaming: true`
// until the text is complete; `done` only becomes true after that.
//
// Returns { shown, done, skip }. `skip` jumps to everything received so far.
// With reduced motion the text appears as soon as it arrives.
//
// Render the full text for screen readers (e.g. in .sr-only) and mark the
// animated copy aria-hidden, so assistive tech doesn't read it letter by letter.
export function useTypewriter(text, { instant = false, streaming = false } = {}) {
  const immediate = instant || reducedMotion()
  const [state, setState] = useState(() => ({ text, count: immediate ? text.length : 0 }))

  // New text: keep our place if it's the same text with more on the end;
  // otherwise start again. (React's pattern for adjusting state on prop change.)
  if (state.text !== text) {
    const grew = text.startsWith(state.text)
    setState({ text, count: immediate ? text.length : grew ? state.count : 0 })
  }

  const behind = state.count < text.length

  useEffect(() => {
    if (!behind) return undefined
    const id = setInterval(() => {
      setState((s) => {
        const backlog = s.text.length - s.count
        if (backlog <= 0) return s
        return { ...s, count: s.count + Math.max(1, Math.ceil(backlog / CATCH_UP)) }
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [behind])

  const skip = useCallback(() => setState((s) => ({ ...s, count: s.text.length })), [])

  return { shown: text.slice(0, state.count), done: !streaming && !behind, skip }
}
