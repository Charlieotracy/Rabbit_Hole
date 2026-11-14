import { overlay, pixelRects } from './pixel'

// The guide: a small cream bunny in a miner's helmet with a headlamp.
// 24×29 art pixels, front-facing and sitting.
//
// Animation states built so far:
//   idle  - blinks every few seconds and bobs gently (always on)
//   talk  - mouth opens and closes (pass talking={true})
// Later milestones add dig, cheer, dazed and pop.

const W = 24
const H = 29

const PALETTE = {
  K: 'var(--ink)',
  W: 'var(--fur)',
  S: 'var(--fur-shade)',
  P: 'var(--blush)',
  C: '#f6c3c6', // cheeks
  N: '#e7798a', // nose
  Y: 'var(--gold)', // helmet
  O: '#d49a1f', // helmet brim
  L: '#fff6b0', // lamp
}

// Mouth row 18 is the closed smile; overlays below swap in other frames.
const BODY = [
  '......KKK......KKK......',
  '.....KWWWK....KWWWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KKKKKKKKKKKKKK.....',
  '....KYYYYYKLLKYYYYYK....',
  '...KYYYYYYKLLKYYYYYYK...',
  '...KYYYYYYYKKYYYYYYYK...',
  '..KKOOOOOOOOOOOOOOOOKK..',
  '..KKKKKKKKKKKKKKKKKKKK..',
  '....KWWWWWWWWWWWWWWK....',
  '...KWWWWWWWWWWWWWWWWK...',
  '...KWWKKWWWWWWWWKKWWK...',
  '...KWWKKWWWWWWWWKKWWK...',
  '...KWCCWWWWNNWWWWCCWK...',
  '...KWWWWWWKWWKWWWWWWK...',
  '...KSWWWWWWWWWWWWWWSK...',
  '....KSSWWWWWWWWWWSSK....',
  '....KKSWWWWWWWWWWSKK....',
  '...KWWWWWWWWWWWWWWWWK...',
  '..KWWKWWWWWWWWWWWWKWWK..',
  '..KWWKWWWWWWWWWWWWKWWK..',
  '..KWKSSKWWWWWWWWKSSKWK..',
  '..KWWKKWWWWWWWWWWKKWWK..',
  '.KSSWWWWKKKKKKKKWWWWSSK.',
  '.KKKKKKKK......KKKKKKKK.',
]

const BLINK = overlay(W, H, {
  15: '......WW........WW......',
  16: '......KK........KK......',
})

const MOUTH_OPEN = overlay(W, H, {
  18: '..........KKKK..........',
  19: '..........KPPK..........',
  20: '...........KK...........',
})

export default function Bunny({ talking = false, scale = 4, className = '' }) {
  return (
    <svg
      className={`sprite bunny ${talking ? 'bunny--talking' : ''} ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      aria-hidden="true"
      focusable="false"
    >
      <g>{pixelRects(BODY, PALETTE, 'b')}</g>
      <g className="bunny__blink">{pixelRects(BLINK, PALETTE, 'e')}</g>
      <g className="bunny__mouth">{pixelRects(MOUTH_OPEN, PALETTE, 'm')}</g>
    </svg>
  )
}
