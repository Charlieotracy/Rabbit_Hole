import { steppedCorners } from '../scene/sprites/generate'
import { mirror, pixelRects, transpose } from '../scene/sprites/pixel'

// Speech bubble: cream fill, ink outline with rounded pixel corners, hard shadow.
//
// variant: "bunny" (default) | "player" | "cave" | "artifact" | "plain"
// tail:    "none" (default) | "down" | "left" | "left-low" (near the bottom) | "right"
// round:   "lg" (big pixel-circle corners, for the bunny's main speech bubbles)
//          | "md" (default) | "sm" (small, for the HUD)
// label:   optional small heading inside, e.g. "LAYER 2 · EVENT HORIZON"

// Corner shapes: how far each row from the top is inset, in --px units.
const CORNERS = {
  lg: steppedCorners([9, 6, 5, 4, 3, 2, 1, 1, 1]),
  md: steppedCorners([5, 3, 2, 1, 1]),
  sm: steppedCorners([3, 2, 1]),
}

// Tail drawn pointing down-left. The first two rows overlap the bubble (one
// row of fill inside it, then its outline), so the fill runs straight into
// the tail and no zoom level can open a gap between them. L = outline, F = fill.
const TAIL_DOWN = [
  'FFFFFFFFFF',
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
const TAIL_LEFT = mirror(TAIL_RIGHT)
// Same tail flipped upside down, for a bubble whose speaker is below-left of it.
const TAILS = { down: TAIL_DOWN, right: TAIL_RIGHT, left: TAIL_LEFT, 'left-low': [...TAIL_LEFT].reverse() }
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
  round = variant === 'plain' ? 'sm' : 'md',
  label,
  className = '',
  style,
  as: Tag = 'section',
  children,
  ...rest
}) {
  return (
    <Tag
      className={`bubble bubble--${variant} bubble--round-${round} ${className}`}
      style={{ '--notch': CORNERS[round], ...style }}
      {...rest}
    >
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
