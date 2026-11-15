import { useCallback, useEffect, useReducer, useRef } from 'react'
import * as api from './api'
import { initialState, reducer } from './gameReducer.js'
import { reducedMotion, sleep } from './lib/motion'

// All game state lives here. Components read `game` and call its actions;
// only this file (through api.js) talks to the backend. The state machine
// itself is in gameReducer.js.

// After a right answer: the bunny cheers, then a pause before it shows the tunnels.
const CHEER_PAUSE_MS = 2200

// Runs an API call with a minimum duration, so quick responses still let the
// digging animation read as digging instead of a flicker.
async function atLeast(ms, promise) {
  const [result] = await Promise.all([promise, sleep(reducedMotion() ? 0 : ms)])
  return result
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const busy = useRef(false)

  const perform = useCallback(async (pendingAction, work) => {
    if (busy.current) return
    busy.current = true
    dispatch(pendingAction)
    try {
      await work()
    } catch (e) {
      const lost = e instanceof api.ApiError && e.status === 404
      dispatch({ type: 'fail', message: e.message, lost })
    } finally {
      busy.current = false
    }
  }, [])

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
    perform({ type: 'start/pending', topic }, async () => {
      const data = await atLeast(1200, api.createRun(topic))
      dispatch({ type: 'start/ok', data })
    })

  const readyForQuestion = () => {
    if (current && !current.ready) dispatch({ type: 'question/ready' })
  }

  const answer = (index) => {
    if (!current || !current.ready || current.chosen !== null || state.breakthrough) return
    perform({ type: 'answer/pending', index }, async () => {
      const data = await atLeast(700, api.submitAnswer(runId, index))
      if (data.correct) dispatch({ type: 'answer/right', artifact: data.artifact, tunnels: data.tunnels })
      else dispatch({ type: 'answer/wrong', turn: data.cave_in })
    })
  }

  const chooseTunnel = (index) => {
    if (!state.breakthrough || state.breakthrough.chosen !== null) return
    perform({ type: 'dig/pending', index }, async () => {
      // Long enough for the bunny to dig itself down before the camera moves.
      const data = await atLeast(1400, api.dig(runId, index))
      dispatch({ type: 'dig/ok', data })
    })
  }

  const confirmSurface = () =>
    perform({ type: 'surface/pending' }, async () => {
      const summary = await atLeast(500, api.getRun(runId))
      dispatch({ type: 'surface/ok', summary })
    })

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
    reset: () => dispatch({ type: 'reset' }),
  }
}
