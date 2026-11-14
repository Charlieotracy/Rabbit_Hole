import { useEffect, useState } from 'react'
import ChatLog from '../chat/ChatLog'
import Particles from '../effects/Particles'
import DepthGauge from '../hud/DepthGauge'
import Hud from '../hud/Hud'
import { reducedMotion } from '../lib/motion'
import { isDark } from '../lib/strata'
import Bunny from '../scene/sprites/Bunny'

// How long the one-shot reactions to big moments last.
const FLASH_MS = { cave: 1600, break: 1100 }

// The latest cave-in / break-through stays "active" for a moment, so the
// bunny can react and the screen can shake. A timer marks it expired.
function useFlash(event) {
  const [expiredId, setExpiredId] = useState(null)
  const ms = FLASH_MS[event.type]
  useEffect(() => {
    if (!ms) return undefined
    const t = setTimeout(() => setExpiredId(event.id), ms)
    return () => clearTimeout(t)
  }, [event.id, ms])
  return ms && expiredId !== event.id ? event : null
}

export default function RunScreen({ game }) {
  const [talking, setTalking] = useState(false)
  const flash = useFlash(game.event)

  // Each new layer starts at the top of the page.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [game.depth])

  // The bunny digs itself down after a right answer, pops back up to point
  // out the tunnels, digs down again into the chosen tunnel, and drops in
  // from above on each new layer.
  const stage = game.breakthrough?.stage
  let motion = 'drop'
  if (game.pending === 'dig' || stage === 'dig') motion = 'sink'
  else if (stage === 'reveal') motion = 'rise'

  let mood = 'idle'
  if (motion === 'sink') mood = 'dig'
  else if (flash?.type === 'cave') mood = 'dazed'
  else if (talking) mood = 'talk'

  const caving = flash?.type === 'cave'
  // The first layer waits for the bunny to dig down from the surface and the
  // camera to follow; deeper layers only wait for the camera.
  const enterDelay = game.depth === 1 ? 2.1 : 0.8

  return (
    <main className={`app run ${caving ? 'run--shake' : ''}`} style={{ '--hud-delay': `${enterDelay}s` }}>
      <Hud game={game} />
      <DepthGauge depth={game.depth} />
      {caving && <Particles key={flash.id} mode="fall" count={26} className="run__rubble" />}

      <section
        className="chat"
        key={game.depth}
        aria-label={`Layer ${game.depth}: ${game.topic}`}
        style={{ '--enter-delay': `${enterDelay}s`, '--drop-delay': `${enterDelay + 0.2}s` }}
      >
        <div className="chat__avatar">
          <Bunny mood={mood} motion={motion} lamp={isDark(game.depth)} scale={3} />
        </div>
        <ChatLog game={game} onTyping={setTalking} />
      </section>
    </main>
  )
}
