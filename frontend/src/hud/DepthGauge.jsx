import { stratum } from '../lib/strata'

// Vertical ruler down the left edge (wide screens only): one tick per
// stratum, with a carrot marker that slides down as you dig.
export default function DepthGauge({ depth }) {
  const max = Math.max(6, depth + 2)
  const at = (d) => `${((d - 1) / (max - 1)) * 100}%`

  return (
    <div className="gauge" aria-hidden="true">
      <div className="gauge__track">
        {Array.from({ length: max }, (_, i) => {
          const d = i + 1
          return (
            <div key={d} className={`gauge__tick ${d < depth ? 'is-dug' : ''} ${d === depth ? 'is-here' : ''}`} style={{ top: at(d) }}>
              <span className="gauge__label">{stratum(d).name}</span>
            </div>
          )
        })}
        <div className="gauge__marker" style={{ top: at(depth) }} />
      </div>
    </div>
  )
}
