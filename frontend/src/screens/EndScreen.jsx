import { useEffect, useRef, useState } from 'react'
import ArtifactShelf from '../end/ArtifactShelf'
import TunnelMap from '../end/TunnelMap'
import { endHeadline } from '../lib/lines'
import { copyText, shareText } from '../lib/share'
import Bunny from '../scene/sprites/Bunny'
import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'
import Title from '../ui/Title'
import Typed from '../ui/Typed'

// Back on the surface: the bunny pops out of its burrow with a summary, then
// the artifacts, a map of the dig, and Share / Dig again.
export default function EndScreen({ game }) {
  const { summary, history } = game
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const cleared = summary.layers_cleared
  const share = async () => {
    const ok = await copyText(shareText({ topic: summary.topic, depth: summary.depth, history }))
    setToast(ok ? 'Copied! Paste it anywhere to share.' : "Couldn't copy. Try again?")
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }

  return (
    <main className="app end">
      <section className="end__hero">
        <Title tagline="back on the surface" />
        <Bubble tail="down" round="lg" className="end__bubble">
          <p className="end__headline">
            <Typed text={endHeadline(summary.depth, summary.topic)} />
          </p>
          <dl className="stats">
            <div>
              <dt>Depth</dt>
              <dd>{summary.depth}</dd>
            </div>
            <div>
              <dt>Layers cleared</dt>
              <dd>{cleared}</dd>
            </div>
            <div>
              <dt>First try</dt>
              <dd>
                {summary.first_try_count}/{cleared}
              </dd>
            </div>
          </dl>
        </Bubble>
        {/* The bunny pops back up out of its hole once the camera reaches the surface. */}
        <div className="start__ground end__ground" style={{ '--rise-delay': '1.2s' }}>
          <Bunny mood="cheer" motion="rise" />
        </div>
      </section>

      <section className="end__more">
        <Bubble variant="artifact" label={`Artifacts unearthed (${summary.artifacts.length})`}>
          <ArtifactShelf artifacts={summary.artifacts} />
        </Bubble>

        <Bubble label="Your tunnel">
          <TunnelMap map={summary.map} />
          <p className="map__legend">
            <span className="map__key map__key--dug" /> dug
            <span className="map__key map__key--skipped" /> skipped
            <span className="map__key map__key--rock" /> cave-in
          </p>
        </Bubble>

        <div className="end__actions">
          <PixelButton onClick={share}>Share result</PixelButton>
          <PixelButton variant="primary" size="lg" onClick={game.reset}>
            Dig again ⛏
          </PixelButton>
        </div>
        <p className="toast" role="status">
          {toast}
        </p>
      </section>
    </main>
  )
}
