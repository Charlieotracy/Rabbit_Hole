import { useState } from 'react'
import { useTypewriter } from '../lib/useTypewriter'
import Bunny from '../scene/sprites/Bunny'
import { Burrow, Carrot } from '../scene/sprites/props'
import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'
import Title from '../ui/Title'

const GREETING = 'Hi! What should we dig into today?'
const SUGGESTIONS = ['black holes', 'the Roman Empire', 'jazz', 'how volcanoes work']

export default function StartScreen({ onStart, disabled }) {
  const [topic, setTopic] = useState('')
  const greeting = useTypewriter(GREETING)

  const send = (value) => {
    const clean = value.trim()
    if (!disabled && clean) onStart(clean)
  }

  const submit = (e) => {
    e.preventDefault()
    send(topic)
  }

  return (
    <section className="start" aria-label="Start a dig">
      <Title tagline="dig into anything" />

      <Bubble tail="down" className="start__bubble">
        <p className="start__greeting" onClick={greeting.skip}>
          <span className="sr-only">{GREETING}</span>
          <span aria-hidden="true">
            {greeting.shown}
            {!greeting.done && <span className="caret" />}
          </span>
        </p>

        <form className="topic-input" onSubmit={submit}>
          <label className="sr-only" htmlFor="topic">
            Topic to dig into
          </label>
          <input
            id="topic"
            className="topic-input__field"
            placeholder="type any topic…"
            autoComplete="off"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <PixelButton
            type="submit"
            className="topic-input__send"
            aria-label="Send"
            disabled={disabled || !topic.trim()}
          >
            <Carrot />
          </PixelButton>
        </form>

        <div className="chips">
          <span className="chips__label">or try</span>
          {SUGGESTIONS.map((s) => (
            <PixelButton key={s} variant="reply" size="sm" onClick={() => send(s)} disabled={disabled}>
              {s}
            </PixelButton>
          ))}
        </div>
      </Bubble>

      <div className="start__ground">
        <Bunny talking={!greeting.done} className="start__bunny" />
        <Burrow className="start__burrow" />
      </div>
    </section>
  )
}
