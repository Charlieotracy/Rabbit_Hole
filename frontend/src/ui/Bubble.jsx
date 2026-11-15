import { steppedCorners } from '../scene/sprites/generate'
import { pixelRects } from '../scene/sprites/pixel'

// Speech bubble: cream fill, ink outline with rounded pixel corners, hard shadow.
//
// variant: "bunny" (default) | "player" | "cave" | "artifact" | "plain"
// tail:    "none" (default) | "down" (big, under the bubble) | "left-low" (small, on the left near the bottom)
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
// Small side tail pointing down-left at the bunny. Kept tiny (4 pixels tall)
// so it fits on the straight part of the left edge of even the shortest
// bubble (the "..." typing bubble). The last two columns overlap the bubble:
// column 3 sits on its outline (open in the middle so the fill flows
// through), column 4 is inside it.
const TAIL_SIDE = [
  '...LF',
  '..LFF',
  '.LFFF',
  'LLLLF',
]
const TAILS = { down: TAIL_DOWN, 'left-low': TAIL_SIDE }
const TAIL_PALETTE = { L: 'var(--bubble-line)', F: 'var(--bubble-fill)' }

function Tail({ side }) {
  const rows = TAILS[side]
  return (
    <svg
      className={`sprite bubble__tail bubble__tail--${side}`}
      viewBox={`0 0 ${rows[0].length} ${rows.length}`}
      style={{ width: `calc(var(--px) * ${rows[0].length})`, height: `calc(var(--px) * ${rows.length})` }}
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
