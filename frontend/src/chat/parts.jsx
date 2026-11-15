import { useEffect, useState } from 'react'
import { READY_PROMPT } from '../lib/lines'
import { TunnelArch } from '../scene/sprites/underground'
import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'
import Typed from '../ui/Typed'

// The pieces a chat transcript is made of. See messages.js for the kinds.
// `newest` marks the bubble right beside the bunny: only it gets a tail.

const READY_DELAY_MS = 2000

// Grows in from zero height so the older messages above slide up smoothly.
// Clipping is only applied while growing, so tails and shadows aren't cut off.
export function Enter({ children }) {
  const [entering, setEntering] = useState(true)
  return (
    <div
      className={`enter ${entering ? 'is-entering' : ''}`}
      onAnimationEnd={(e) => e.target === e.currentTarget && setEntering(false)}
    >
      <div className="enter__inner">{children}</div>
    </div>
  )
}

// "Ready for a question?" appears at the bottom of the explanation bubble a
// couple of seconds after the bunny finishes typing it.
function ReadyAction({ onClick }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), READY_DELAY_MS)
    return () => clearTimeout(t)
  }, [])
  if (!shown) return null
  return (
    <div className="bubble-actions">
      <PixelButton variant="primary" onClick={onClick} autoFocus>
        {READY_PROMPT}
      </PixelButton>
    </div>
  )
}

export function BunnySays({ m, newest, seen, skipToken, onTyping, onDone, game, busy }) {
  const [typed, setTyped] = useState(seen)
  const finish = () => {
    setTyped(true)
    onDone()
  }

  return (
    <div className="msg msg--bunny">
      <Bubble variant={m.variant ?? 'bunny'} tail={newest ? 'left-low' : 'none'} label={m.label} as="div">
        <p className="msg__text">
          <Typed text={m.text} instant={seen} skipToken={skipToken} onTyping={onTyping} onDone={finish} />
        </p>
        {m.ready && typed && <ReadyAction onClick={game.readyForQuestion} />}
        {m.confirm && typed && (
          <div className="bubble-actions" role="group" aria-label="Head back up?">
            <PixelButton variant="primary" onClick={game.confirmSurface} disabled={busy}>
              Yes, surface ↑
            </PixelButton>
            <PixelButton onClick={game.cancelSurface} disabled={busy}>
              Keep digging
            </PixelButton>
          </div>
        )}
      </Bubble>
      {m.tunnels && typed && (
        <TunnelPicker tunnels={m.tunnels} chosen={m.chosenTunnel} onPick={game.chooseTunnel} disabled={busy} />
      )}
    </div>
  )
}

// The question and its four options in one bubble. The options appear once
// the question has finished typing; after an answer they show what was picked.
export function QuestionBubble({ m, newest, seen, skipToken, onTyping, onDone, game, busy }) {
  const [typed, setTyped] = useState(seen)
  const finish = () => {
    setTyped(true)
    onDone()
  }

  return (
    <div className="msg msg--bunny">
      <Bubble tail={newest ? 'left-low' : 'none'} as="div">
        <p className="msg__question">
          <Typed text={m.text} instant={seen} skipToken={skipToken} onTyping={onTyping} onDone={finish} />
        </p>
        {typed && (
          <ol className="options" aria-label="Answer options">
            {m.options.map((option, i) => {
              const state = m.chosen === i ? `option--${m.result ?? 'picked'}` : m.chosen !== null ? 'option--other' : ''
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`option ${state}`}
                    onClick={() => game.answer(i)}
                    disabled={!m.answerable || busy}
                  >
                    <span className="pbtn__key">{i + 1}</span>
                    <span>{option}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </Bubble>
    </div>
  )
}

export function Typing({ newest }) {
  return (
    <div className="msg msg--bunny msg--typing">
      <Bubble as="div" className="typing" tail={newest ? 'left-low' : 'none'}>
        <span className="typing__dots" role="img" aria-label="The bunny is typing">
          <i />
          <i />
          <i />
        </span>
      </Bubble>
    </div>
  )
}

export function TunnelPicker({ tunnels, chosen, onPick, disabled }) {
  const picked = chosen !== null && chosen !== undefined
  return (
    <div className="tunnels" role="group" aria-label="Choose a tunnel">
      {tunnels.map((tunnel, i) => (
        <button
          key={i}
          type="button"
          className={`tunnel ${picked ? (chosen === i ? 'tunnel--chosen' : 'tunnel--other') : ''}`}
          onClick={() => onPick(i)}
          disabled={disabled || picked}
        >
          <TunnelArch className="tunnel__arch" />
          <span className="tunnel__label">
            <span className="pbtn__key">{i + 1}</span>
            {tunnel}
          </span>
        </button>
      ))}
    </div>
  )
}
