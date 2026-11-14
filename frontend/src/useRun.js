import { useCallback, useRef, useState } from 'react'
import * as api from './api'

const LOST_MESSAGE =
  'This run was lost because the server restarted. Start a new run to keep playing.'

// phase: "start" | "question" | "caved_in" | "broke_through" | "loading" | "surfaced"
export function useRun() {
  const [runId, setRunId] = useState(null)
  const [topic, setTopic] = useState('')
  const [depth, setDepth] = useState(0)
  const [turn, setTurn] = useState(null)
  const [phase, setPhase] = useState('start')
  const [artifact, setArtifact] = useState(null)
  const [tunnels, setTunnels] = useState([])
  const [wrongCount, setWrongCount] = useState(0)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const previousPhase = useRef('start')
  const phaseRef = useRef('start')

  const changePhase = (next) => {
    phaseRef.current = next
    setPhase(next)
  }

  // Runs an API call with loading/error handling. On failure, returns to the
  // phase we were in before; a 404 means the run is gone, so start over.
  const call = useCallback(async (fn) => {
    previousPhase.current = phaseRef.current
    changePhase('loading')
    setError(null)
    try {
      await fn()
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 404) {
        setRunId(null)
        setTurn(null)
        setArtifact(null)
        setTunnels([])
        setError(LOST_MESSAGE)
        changePhase('start')
      } else {
        setError(e.message)
        changePhase(previousPhase.current)
      }
    }
  }, [])

  const startRun = (topicInput) =>
    call(async () => {
      const data = await api.createRun(topicInput)
      setRunId(data.run_id)
      setTopic(data.topic)
      setDepth(data.depth)
      setTurn(data.turn)
      setArtifact(null)
      setTunnels([])
      setWrongCount(0)
      setSummary(null)
      changePhase('question')
    })

  const answer = (optionIndex) =>
    call(async () => {
      const data = await api.submitAnswer(runId, optionIndex)
      if (data.correct) {
        setArtifact(data.artifact)
        setTunnels(data.tunnels)
        changePhase('broke_through')
      } else {
        setTurn(data.cave_in)
        setWrongCount((n) => n + 1)
        changePhase('caved_in')
      }
    })

  const chooseTunnel = (tunnelIndex) =>
    call(async () => {
      const data = await api.dig(runId, tunnelIndex) // no run_id in response
      setDepth(data.depth)
      setTopic(data.topic)
      setTurn(data.turn)
      setArtifact(null)
      setTunnels([])
      setWrongCount(0)
      changePhase('question')
    })

  const surface = () =>
    call(async () => {
      setSummary(await api.getRun(runId))
      changePhase('surfaced')
    })

  const reset = () => {
    setRunId(null)
    setTopic('')
    setDepth(0)
    setTurn(null)
    setArtifact(null)
    setTunnels([])
    setWrongCount(0)
    setSummary(null)
    setError(null)
    changePhase('start')
  }

  return {
    runId, topic, depth, turn, phase, artifact, tunnels,
    wrongCount, summary, error,
    startRun, answer, chooseTunnel, surface, reset,
  }
}
