import { useEffect, useState } from 'react'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Reveals `text` a character at a time, like the bunny is typing.
// Returns { shown, done, skip }. With reduced motion the text appears at once.
//
// Render the full text for screen readers (e.g. in .sr-only) and mark the
// animated copy aria-hidden, so assistive tech doesn't read it letter by letter.
export function useTypewriter(text, charsPerSecond = 38) {
  const initial = () => ({ text, count: reducedMotion() ? text.length : 0 })
  const [state, setState] = useState(initial)

  // New text: restart during render (React's pattern for resetting on prop change).
  if (state.text !== text) setState(initial())

  const done = state.count >= text.length

  useEffect(() => {
    if (done) return undefined
    const id = setInterval(() => {
      setState((s) => (s.count >= s.text.length ? s : { ...s, count: s.count + 1 }))
    }, 1000 / charsPerSecond)
    return () => clearInterval(id)
  }, [text, done, charsPerSecond])

  return {
    shown: text.slice(0, state.count),
    done,
    skip: () => setState({ text, count: text.length }),
  }
}
