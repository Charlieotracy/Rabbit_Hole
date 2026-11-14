import { GrassTuft } from '../scene/sprites/props'

const NAME = 'Rabbit Hole'
// Letters (by index) that get a grass tuft on top: R, the second b, H, l.
const TUFTED = new Set([0, 3, 7, 9])

// Dark pixel logo that grows out of the ground: ink letters, a hard
// grass-green shadow, and grass tufts sprouting from the tops of some letters.
export default function Title({ tagline, subline }) {
  return (
    <header className="title">
      <h1 className="title__logo" aria-label={NAME}>
        <span aria-hidden="true">
          {[...NAME].map((ch, i) =>
            TUFTED.has(i) ? (
              <span key={i} className="title__letter">
                {ch}
                <GrassTuft className="title__tuft" />
              </span>
            ) : (
              ch
            ),
          )}
        </span>
      </h1>
      {tagline && <p className="title__tagline">{tagline}</p>}
      {subline && <p className="title__subline">{subline}</p>}
    </header>
  )
}
