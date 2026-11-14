import { mirror, pixelRects, transpose } from '../scene/sprites/pixel'

// Speech bubble: cream fill, ink outline with stepped pixel corners, hard shadow.
//
// variant: "bunny" (default) | "player" | "cave" | "artifact" | "plain"
// tail:    "none" (default) | "down" | "left" | "right"
// label:   optional small heading inside, e.g. "LAYER 2 · EVENT HORIZON"

// Tail drawn pointing down-left. Row 0 overlaps the bubble's bottom outline
// so the fill runs straight into the tail. L = outline, F = fill.
const TAIL_DOWN = [
  'LFFFFFFFFL',
  'LFFFFFFFL.',
  'LFFFFFFL..',
  'LFFFFFL...',
  'LFFFFL....',
  'LFFFL.....',
  'LFFL......',
  'LFL.......',
  'LL........',
]
const TAIL_RIGHT = transpose(TAIL_DOWN)
const TAILS = { down: TAIL_DOWN, right: TAIL_RIGHT, left: mirror(TAIL_RIGHT) }
const TAIL_PALETTE = { L: 'var(--bubble-line)', F: 'var(--bubble-fill)' }

function Tail({ side }) {
  const rows = TAILS[side]
  return (
    <svg
      className={`sprite bubble__tail bubble__tail--${side}`}
      viewBox={`0 0 ${rows[0].length} ${rows.length}`}
      aria-hidden="true"
      focusable="false"
    >
      {pixelRects(rows, TAIL_PALETTE)}
    </svg>
  )
}

export default function Bubble({
  variant = 'bunny',
  tail = 'none',
  label,
  className = '',
  as: Tag = 'section',
  children,
  ...rest
}) {
  return (
    <Tag className={`bubble bubble--${variant} ${className}`} {...rest}>
      <div className="bubble__frame">
        <div className="bubble__body">
          {label && <p className="bubble__label">{label}</p>}
          {children}
        </div>
      </div>
      {tail !== 'none' && <Tail side={tail} />}
    </Tag>
  )
}
