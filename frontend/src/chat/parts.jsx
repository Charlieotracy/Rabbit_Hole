import { useEffect, useState } from 'react'
import { TunnelArch } from '../scene/sprites/underground'
import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'
import Typed from '../ui/Typed'

// The pieces a chat transcript is made of. See messages.js for the kinds.

export function BunnySays({ m, first, seen, skipToken, onTyping, onDone }) {
  return (
    <div className={`msg msg--bunny ${m.old ? 'msg--old' : ''}`}>
      <Bubble variant={m.variant ?? 'bunny'} tail={first ? 'left' : 'none'} label={m.label} as="div">
        <p className="msg__text">
          <Typed text={m.text} instant={seen} skipToken={skipToken} onTyping={onTyping} onDone={onDone} />
        </p>
      </Bubble>
    </div>
  )
}

// The question and its four options in one bubble. The options appear once
// the question has finished typing; after an answer they show what was picked.
export function QuestionBubble({ m, first, seen, skipToken, onTyping, onDone, onPick, disabled }) {
  const [typed, setTyped] = useState(seen)
  const finish = () => {
    setTyped(true)
    onDone()
  }

  return (
    <div className={`msg msg--bunny ${m.old ? 'msg--old' : ''}`}>
      <Bubble tail={first ? 'left' : 'none'} as="div">
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
                    onClick={() => onPick(i)}
                    disabled={!m.answerable || disabled}
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

export function ReadyButton({ label, onClick }) {
  return (
    <div className="msg msg--replies">
      <PixelButton variant="primary" onClick={onClick} autoFocus>
        {label}
      </PixelButton>
    </div>
  )
}

export function PlayerSays({ m }) {
  const result = m.result ? `msg--${m.result}` : ''
  return (
    <div className={`msg msg--player ${result} ${m.old ? 'msg--old' : ''}`}>
      <Bubble variant="player" tail="right" as="div">
        <p className="msg__text">{m.text}</p>
        {m.result === 'wrong' && <p className="msg__badge">✗ caved in</p>}
        {m.result === 'right' && <p className="msg__badge">✓ broke through</p>}
      </Bubble>
    </div>
  )
}

export function Typing() {
  return (
    <div className="msg msg--bunny">
      <Bubble as="div" className="typing">
        <span className="typing__dots" role="img" aria-label="The bunny is typing">
          <i />
          <i />
          <i />
        </span>
      </Bubble>
    </div>
  )
}

export function TunnelPicker({ tunnels, onPick, disabled }) {
  return (
    <div className="msg msg--tunnels" role="group" aria-label="Choose a tunnel">
      {tunnels.map((tunnel, i) => (
        <button key={i} type="button" className="tunnel" onClick={() => onPick(i)} disabled={disabled}>
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

export function SurfaceConfirm({ onYes, onNo, disabled }) {
  return (
    <div className="msg msg--replies" role="group" aria-label="Head back up?">
      <PixelButton variant="primary" onClick={onYes} disabled={disabled}>
        Yes, surface ↑
      </PixelButton>
      <PixelButton variant="reply" onClick={onNo} disabled={disabled}>
        Keep digging
      </PixelButton>
    </div>
  )
}

// Marks a non-typing message as seen as soon as it appears, so the next
// message in the transcript can start.
export function SeenOnMount({ onDone, children }) {
  // Marking seen is idempotent, so re-running on a new callback is harmless.
  useEffect(() => {
    onDone()
  }, [onDone])
  return children
}
