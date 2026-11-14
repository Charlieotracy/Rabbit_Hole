import { useCallback, useEffect, useState } from 'react'
import { reducedMotion } from './motion'

// Reveals `text` a character at a time, like the bunny is typing.
// Long text speeds up so no message takes much more than ~2.5s.
// Returns { shown, done, skip }. With reduced motion the text appears at once.
//
// Render the full text for screen readers (e.g. in .sr-only) and mark the
// animated copy aria-hidden, so assistive tech doesn't read it letter by letter.
export function useTypewriter(text, { instant = false } = {}) {
  const initial = () => ({ text, count: instant || reducedMotion() ? text.length : 0 })
  const [state, setState] = useState(initial)

  // New text: restart during render (React's pattern for resetting on prop change).
  if (state.text !== text) setState(initial())

  const done = state.count >= text.length
  const charsPerSecond = Math.max(40, text.length / 2.5)
  // Advance a few characters per tick for fast text rather than ticking faster than frames.
  const step = Math.max(1, Math.round(charsPerSecond / 60))

  useEffect(() => {
    if (done) return undefined
    const id = setInterval(() => {
      setState((s) => (s.count >= s.text.length ? s : { ...s, count: Math.min(s.text.length, s.count + step) }))
    }, (1000 / charsPerSecond) * step)
    return () => clearInterval(id)
  }, [text, done, charsPerSecond, step])

  const skip = useCallback(() => setState({ text, count: text.length }), [text])

  return { shown: text.slice(0, state.count), done, skip }
}
