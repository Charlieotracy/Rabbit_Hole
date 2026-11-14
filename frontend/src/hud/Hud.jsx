import { stratum } from '../lib/strata'
import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'

// Top bar during a run: depth, the trail of tunnels dug so far, cave-ins on
// this layer, and the always-available Surface button.
export default function Hud({ game }) {
  const { depth, path, caveInsHere } = game
  const trail = path.length > 3 ? ['…', ...path.slice(-3)] : path
  const layerName = stratum(depth).name

  return (
    <header className="hud">
      <Bubble variant="plain" as="div">
        <div className="hud__row">
          <span className="hud__depth" title={layerName}>
            <span aria-hidden="true">⛏</span> {depth}
            <small>
              <span className="sr-only">Layer {depth}, </span>
              {layerName}
            </small>
          </span>

          <nav className="hud__trail" aria-label="Your tunnel so far">
            <ol>
              {trail.map((t, i) => (
                <li key={`${i}-${t}`}>{t}</li>
              ))}
            </ol>
          </nav>

          {caveInsHere > 0 && (
            <span className="hud__pips" title={`${caveInsHere} cave-in${caveInsHere > 1 ? 's' : ''} on this layer`}>
              <span className="sr-only">{caveInsHere} cave-ins on this layer</span>
              {Array.from({ length: Math.min(caveInsHere, 5) }, (_, i) => (
                <i key={i} aria-hidden="true" />
              ))}
            </span>
          )}

          <PixelButton
            size="sm"
            variant="ghost"
            onClick={game.askSurface}
            disabled={Boolean(game.pending) || game.confirmingSurface}
          >
            Surface ↑
          </PixelButton>
        </div>
      </Bubble>
    </header>
  )
}
