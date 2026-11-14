import { useEffect, useRef } from 'react'
import { useTypewriter } from '../lib/useTypewriter'

// Text that types itself out, like the bunny is writing it. Screen readers
// get the full sentence at once; the animated copy is hidden from them.
//
// instant:   show everything immediately (already-seen messages)
// skipToken: change this number to finish typing right away
// onTyping:  called with true while typing, false when done
// onDone:    called once when the text has fully appeared
export default function Typed({ text, instant = false, skipToken = 0, onTyping, onDone }) {
  const typed = useTypewriter(text, { instant })
  const { done, skip } = typed
  const startToken = useRef(skipToken)

  useEffect(() => {
    if (skipToken !== startToken.current) skip()
  }, [skipToken, skip])

  useEffect(() => {
    onTyping?.(!done)
  }, [done, onTyping])

  // onDone may be a new function each render; callers make it safe to repeat.
  useEffect(() => {
    if (done) onDone?.()
  }, [done, onDone])

  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {typed.shown}
        {!done && <span className="caret" />}
      </span>
    </>
  )
}
