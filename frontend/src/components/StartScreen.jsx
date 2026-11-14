import { useState } from 'react'

export default function StartScreen({ onStart, disabled }) {
  const [topic, setTopic] = useState('black holes')
  return (
    <div>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} />
      <button onClick={() => onStart(topic.trim())} disabled={disabled || !topic.trim()}>
        Dig
      </button>
    </div>
  )
}
