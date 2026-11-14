import { stratum } from '../lib/strata'
import { BuriedProp } from './sprites/underground'

const rand = (depth, i, salt) => {
  const n = Math.sin(depth * 127.1 + i * 311.7 + salt * 74.7) * 43758.5453
  return n - Math.floor(n)
}

// One screen-tall band of ground. Its colour fades into the next layer's,
// and it's scattered with props (pebbles, fossils, roots...). Props favour
// the left and right edges, where the chat column doesn't cover them.
export default function Stratum({ depth, height }) {
  const here = stratum(depth)
  const next = stratum(depth + 1)
  const count = 12

  return (
    <div
      className="stratum"
      style={{ height, background: `linear-gradient(to bottom, ${here.color} 0%, ${here.color} 55%, ${next.color} 100%)` }}
    >
      {Array.from({ length: count }, (_, i) => {
        const kind = here.props[i % here.props.length]
        const side = i % 2 === 0 ? rand(depth, i, 1) * 22 : 78 + rand(depth, i, 1) * 20
        const top = kind === 'root' && depth === 1 ? 0 : 6 + rand(depth, i, 2) * 86
        return (
          <BuriedProp
            key={i}
            kind={kind}
            flip={rand(depth, i, 3) > 0.5}
            scale={kind === 'ember' ? 3 : 4}
            className={`stratum__prop stratum__prop--${kind}`}
            style={{ left: `${side}%`, top: `${top}%` }}
          />
        )
      })}
    </div>
  )
}
