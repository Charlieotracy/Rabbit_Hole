import { useState } from 'react'
import Panel from '../ui/Panel'
import PixelButton from '../ui/PixelButton'

export default function StartScreen({ onStart, disabled }) {
  const [topic, setTopic] = useState('black holes')
  const canStart = !disabled && topic.trim()

  const submit = (e) => {
    e.preventDefault()
    if (canStart) onStart(topic.trim())
  }

  return (
    <Panel className="start">
      <form className="start__form" onSubmit={submit}>
        <label className="sr-only" htmlFor="topic">
          Topic
        </label>
        <input
          id="topic"
          className="pixel-input"
          placeholder="type any topic…"
          autoComplete="off"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <PixelButton type="submit" size="lg" disabled={!canStart}>
          ▼ Start digging ▼
        </PixelButton>
      </form>
    </Panel>
  )
}
