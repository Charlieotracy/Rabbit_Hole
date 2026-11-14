import { useEffect } from 'react'
import Particles from '../effects/Particles'
import ArtifactIcon from '../scene/sprites/icons'
import { TunnelArch } from '../scene/sprites/underground'
import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'
import Typed from '../ui/Typed'

// The pieces a chat transcript is made of. See messages.js for the kinds.

export function BunnySays({ m, first, seen, skipToken, onTyping, onDone }) {
  return (
    <div className={`msg msg--bunny ${m.old ? 'msg--old' : ''}`}>
      <Bubble variant={m.variant ?? 'bunny'} tail={first ? 'left' : 'none'} label={m.label} as="div">
        <p className={m.emphasis ? 'msg__question' : 'msg__text'}>
          <Typed text={m.text} instant={seen} skipToken={skipToken} onTyping={onTyping} onDone={onDone} />
        </p>
      </Bubble>
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

export function ReplyChips({ options, onPick, disabled }) {
  return (
    <div className="msg msg--replies" role="group" aria-label="Pick your answer">
      {options.map((option, i) => (
        <PixelButton key={i} variant="reply" onClick={() => onPick(i)} disabled={disabled}>
          <span className="pbtn__key">{i + 1}</span>
          {option}
        </PixelButton>
      ))}
    </div>
  )
}

export function Typing({ digging }) {
  return (
    <div className="msg msg--bunny">
      <Bubble as="div" className="typing">
        <span className="typing__dots" role="img" aria-label="The bunny is typing">
          <i />
          <i />
          <i />
        </span>
        {digging && <span className="typing__note">digging…</span>}
      </Bubble>
    </div>
  )
}

export function DigBurst() {
  return (
    <div className="msg msg--dig" role="img" aria-label="Digging through the wall">
      <Particles count={22} loop />
      <span className="dig__label">⛏ crunch, crunch…</span>
    </div>
  )
}

export function ArtifactCard({ artifact }) {
  return (
    <div className="msg msg--bunny msg--pop">
      <Bubble variant="artifact" as="div" label="You unearthed:">
        <div className="artifact">
          <span className="artifact__icon">
            <ArtifactIcon name={artifact.icon} scale={5} />
            <span className="artifact__glint" />
          </span>
          <div>
            <p className="artifact__name">{artifact.name}</p>
            <p className="artifact__where">Found in layer {artifact.depth}</p>
          </div>
        </div>
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
