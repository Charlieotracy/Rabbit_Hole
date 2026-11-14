// Pixel dirt particles, pure CSS. Each particle gets its own direction,
// size, colour and delay from a stable pseudo-random sequence.
//
// mode: "burst" - flies up and out from the centre, then falls (digging)
//       "fall"  - drops from the top edge (cave-in)
// loop: repeat forever (while digging) or play once

const COLORS = ['var(--soil-1)', 'var(--soil-2)', 'var(--soil-3)', '#8a6a4a', '#a58463']

const rand = (i, salt) => {
  const n = Math.sin(i * 91.7 + salt * 47.3) * 10000
  return n - Math.floor(n)
}

export default function Particles({ mode = 'burst', count = 12, loop = false, className = '' }) {
  return (
    <span className={`particles particles--${mode} ${loop ? 'particles--loop' : ''} ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const size = 4 + Math.round(rand(i, 1) * 2) * 2
        const style =
          mode === 'burst'
            ? {
                '--dx': `${Math.round((rand(i, 2) - 0.5) * 140)}px`,
                '--dy': `${Math.round(-30 - rand(i, 3) * 60)}px`,
                '--delay': `${(rand(i, 4) * 0.8).toFixed(2)}s`,
              }
            : {
                '--x': `${Math.round(rand(i, 2) * 100)}%`,
                '--fall': `${Math.round(120 + rand(i, 3) * 220)}px`,
                '--delay': `${(rand(i, 4) * 0.35).toFixed(2)}s`,
              }
        return (
          <span
            key={i}
            className="particle"
            style={{ ...style, '--size': `${size}px`, '--color': COLORS[i % COLORS.length] }}
          />
        )
      })}
    </span>
  )
}
