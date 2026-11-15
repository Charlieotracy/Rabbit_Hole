import { useCallback, useEffect, useReducer, useRef } from 'react'
import * as api from './api'
import { initialState, reducer } from './gameReducer.js'
import { reducedMotion, sleep } from './lib/motion'

// All game state lives here. Components read `game` and call its actions;
// only this file (through api.js) talks to the backend. The state machine
// itself is in gameReducer.js.
//
// Content streams in: starting a run, digging and cave-ins pass each piece
// (explanation text, then the question) to the reducer as it arrives, so the
// player starts reading within a second instead of waiting for everything.

// After a right answer: the bunny cheers, then a pause before it shows the tunnels.
const CHEER_PAUSE_MS = 2200

// Runs an API call with a minimum duration, so quick responses still let the
// bunny's animation read properly instead of flickering.
async function atLeast(ms, promise) {
  const [result] = await Promise.all([promise, sleep(reducedMotion() ? 0 : ms)])
  return result
}

// Holds streamed events back until `ms` has passed (so the bunny's dig plays
// before the camera moves), then lets everything through. `opened` resolves
// once the held events have been delivered.
function gate(ms, onEvent, signal) {
  const queue = []
  let open = ms <= 0 || reducedMotion()
  const opened = open
    ? Promise.resolve()
    : sleep(ms).then(() => {
        open = true
        if (!signal.aborted) queue.splice(0).forEach(([name, data]) => onEvent(name, data))
      })
  return { onEvent: (name, data) => (open ? onEvent(name, data) : queue.push([name, data])), opened }
}

// Runs a streamed step behind a gate. If it fails, the held events are still
// delivered first, so the failure lands after (say) the run has started.
async function gated(ms, onEvent, signal, stream) {
  const held = gate(ms, onEvent, signal)
  try {
    await stream(held.onEvent)
  } finally {
    await held.opened
  }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const busy = useRef(false)
  const work = useRef(null) // the in-flight request: { controller, done }

  // Turns streamed events (lib/stream.js) into reducer actions.
  const turnEvents = useCallback(
    (signal) => (name, data) => {
      if (signal.aborted) return
      if (name === 'run') dispatch({ type: 'start/ok', data })
      else if (name === 'layer') dispatch({ type: 'dig/ok', data })
      else if (name === 'cave_in') dispatch({ type: 'turn/style', style: data.style })
      else if (name === 'delta') dispatch({ type: 'turn/delta', text: data.text })
      else if (name === 'explained') dispatch({ type: 'turn/explained', text: data.text })
      else if (name === 'retrying') dispatch({ type: 'turn/retrying', attempt: data.attempt, max: data.max_attempts })
      else if (name === 'question') {
        dispatch({ type: 'turn/question', question: data.question, options: data.options, style: data.style })
      }
    },
    [],
  )

  const perform = useCallback(async (pendingAction, run) => {
    if (busy.current) return
    busy.current = true
    const controller = new AbortController()
    let finish
    work.current = { controller, done: new Promise((resolve) => (finish = resolve)) }
    dispatch(pendingAction)
    try {
      await run(controller.signal)
    } catch (e) {
      if (!controller.signal.aborted && e.name !== 'AbortError') {
        const lost = e instanceof api.ApiError && e.status === 404
        const stream = e instanceof api.StreamError
        dispatch({ type: 'fail', message: e.message, lost, stream })
      }
    } finally {
      busy.current = false
      finish()
      work.current = null
    }
  }, [])

  // Cancels whatever is streaming (e.g. surfacing mid-explanation).
  const stopWork = async () => {
    const current = work.current
    if (!current) return
    current.controller.abort()
    await current.done
  }

  // After a correct answer, let the bunny cheer for a moment, then reveal the tunnels.
  const stage = state.breakthrough?.stage
  useEffect(() => {
    if (stage !== 'dig') return undefined
    const t = setTimeout(() => dispatch({ type: 'reveal' }), reducedMotion() ? 200 : CHEER_PAUSE_MS)
    return () => clearTimeout(t)
  }, [stage])

  const { runId } = state
  const current = state.attempts[state.attempts.length - 1]

  const startRun = (topic) =>
    perform({ type: 'start/pending', topic }, (signal) =>
      gated(1200, turnEvents(signal), signal, (onEvent) => api.createRun(topic, onEvent, signal)),
    )

  const readyForQuestion = () => {
    if (current && !current.ready) dispatch({ type: 'question/ready' })
  }

  const answer = (index) => {
    if (!current || !current.ready || !current.turn.question || current.chosen !== null || state.breakthrough) return
    perform({ type: 'answer/pending', index }, async (signal) => {
      const data = await atLeast(700, api.submitAnswer(runId, index))
      if (signal.aborted) return
      if (data.correct) {
        dispatch({ type: 'answer/right', artifact: data.artifact, tunnels: data.tunnels })
        return
      }
      // Wrong: the cave-in reaction plays right away while the re-explanation streams in.
      dispatch({ type: 'answer/wrong' })
      await api.caveIn(runId, data, turnEvents(signal), signal)
    })
  }

  const chooseTunnel = (index) => {
    if (!state.breakthrough || state.breakthrough.chosen !== null) return
    perform({ type: 'dig/pending', index }, async (signal) => {
      // Long enough for the bunny to dig itself down before the camera moves.
      await gated(1400, turnEvents(signal), signal, (onEvent) => api.dig(runId, index, onEvent, signal))
    })
  }

  const confirmSurface = async () => {
    await stopWork()
    perform({ type: 'surface/pending' }, async (signal) => {
      const summary = await atLeast(500, api.getRun(runId))
      if (!signal.aborted) dispatch({ type: 'surface/ok', summary })
    })
  }

  const reset = async () => {
    await stopWork()
    dispatch({ type: 'reset' })
  }

  // After the first layer's stream breaks: start the same dig over.
  const retryStart = async () => {
    const topic = state.sentTopic || state.rootTopic
    await stopWork()
    dispatch({ type: 'reset' })
    startRun(topic)
  }

  return {
    ...state,
    caveInsHere: Math.max(0, state.attempts.length - 1),
    startRun,
    readyForQuestion,
    answer,
    chooseTunnel,
    askSurface: () => dispatch({ type: 'surface/ask' }),
    cancelSurface: () => dispatch({ type: 'surface/cancel' }),
    confirmSurface,
    reset,
    retryStart,
  }
}
