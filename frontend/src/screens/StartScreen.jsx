import { useState } from 'react'
import { errorLine, GREETING, startReply } from '../lib/lines'
import Bunny from '../scene/sprites/Bunny'
import { Carrot } from '../scene/sprites/props'
import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'
import Title from '../ui/Title'
import Typed from '../ui/Typed'

const SUGGESTIONS = ['black holes', 'the Roman Empire', 'jazz', 'how volcanoes work']

// Lives in the sky section of the World, so it scrolls away with the camera.
//   ask     - greeting, topic input, suggestions
//   sending - the player's topic as a chat bubble, bunny digging
//   gone    - the bunny has dug itself into the ground (the run has started)
export default function StartScreen({ game }) {
  const [topic, setTopic] = useState('')
  const [talking, setTalking] = useState(true)
  const mode = game.pending === 'start' ? 'sending' : game.screen === 'run' ? 'gone' : 'ask'

  const send = (value) => {
    const clean = value.trim()
    if (clean && !game.pending) game.startRun(clean)
  }

  const submit = (e) => {
    e.preventDefault()
    send(topic)
  }

  // While the first layer loads the bunny digs in place; once the run starts
  // it digs itself down into the ground and the camera follows.
  const bunnyMood = mode === 'ask' ? (talking ? 'talk' : 'idle') : 'dig'
  const bunnyMotion = mode === 'gone' ? 'sink' : 'none'

  return (
    <section className={`start start--${mode}`} aria-label="Start a dig">
      <Title tagline="dig into anything" />

      <Bubble tail="down" round="lg" className="start__bubble" aria-live="polite">
        <p className="start__greeting">
          <Typed text={GREETING} onTyping={mode === 'ask' ? setTalking : undefined} />
        </p>

        {mode === 'ask' ? (
          <>
            {game.error && <p className="start__error">{errorLine(game.error)}</p>}
            <form className="topic-input" onSubmit={submit}>
              <label className="sr-only" htmlFor="topic">
                Topic to dig into
              </label>
              <input
                id="topic"
                className="topic-input__field"
                placeholder="type any topic…"
                autoComplete="off"
                maxLength={120}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              <PixelButton type="submit" className="topic-input__send" aria-label="Send" disabled={!topic.trim()}>
                <Carrot />
              </PixelButton>
            </form>
            <div className="chips">
              <span className="chips__label">or try</span>
              {SUGGESTIONS.map((s) => (
                <PixelButton key={s} variant="reply" size="sm" onClick={() => send(s)}>
                  {s}
                </PixelButton>
              ))}
            </div>
          </>
        ) : (
          <div className="start__sent">
            <p className="start__player">{game.sentTopic || game.rootTopic}</p>
            <p className="start__reply">
              <Typed text={startReply(game.sentTopic || game.rootTopic)} />
            </p>
            {mode === 'sending' && <p className="start__hint">Digging up your first layer…</p>}
          </div>
        )}
      </Bubble>

      <div className="start__ground">
        <span className="start__bunny">
          <Bunny mood={bunnyMood} motion={bunnyMotion} />
        </span>
      </div>
    </section>
  )
}
