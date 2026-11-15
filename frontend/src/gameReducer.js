// The game's state machine as a pure reducer (no React, no network), so it
// can be unit-tested with plain Node. useGame.js wires it to the API.
//
// screen:  'start' -> 'run' -> 'end' -> (reset) 'start'
// attempts: the current layer's turns, in order. The first is the original
//   explanation and question; each cave-in adds another. `ready` flips when
//   the player clicks "Ready for a question?", `chosen` is the option they
//   picked and `result` is 'wrong' | 'right' once known.
// turn: filled in as it streams from the backend. `layer` (the explanation)
//   grows piece by piece; `explained` flips when it's final; `question` and
//   `options` arrive later (`retrying` while the backend has another go at a
//   rejected question); `style` is set for cave-in re-explanations, and
//   `introStyle` freezes whatever style was known when the bunny started
//   talking, so its intro line doesn't change mid-sentence. `failed` means the
//   stream broke and no question is coming.

const LOST_MESSAGE = "That dig got lost because the server restarted. Let's start a fresh one!"

export const initialState = {
  screen: 'start',
  runCount: 0, // bumps on reset so the start screen remounts fresh
  runId: null,
  rootTopic: '', // the run's topic as the server restated it
  sentTopic: '', // what the player typed, shown as their chat bubble
  topic: '', // current layer's topic
  depth: 0, // 0 = surface
  path: [], // topic of every layer dug, in order
  attempts: [], // current layer: [{ turn, ready, chosen, result }]
  breakthrough: null, // { artifact, tunnels, stage: 'dig' (cheering pause) | 'reveal' (tunnels shown), chosen }
  history: [], // cleared layers: [{ depth, topic, caveIns }]
  pending: null, // 'start' | 'answer' | 'dig' | 'surface'
  confirmingSurface: false,
  summary: null,
  error: null,
  errorId: 0,
  streamFailed: false, // the current turn's stream broke (offer retry / surface)
  event: { type: null, id: 0 }, // last big moment ('cave' | 'break' | 'descend' | 'surface')
}

const bump = (state, type) => ({ type, id: state.event.id + 1 })

export const emptyTurn = () => ({
  layer: '',
  explained: false,
  question: null,
  options: [],
  style: null,
  introStyle: undefined,
  retrying: null,
  failed: false,
})
const newAttempt = () => ({ turn: emptyTurn(), ready: false, chosen: null, result: null })

const updateLast = (attempts, patch) =>
  attempts.map((a, i) => (i === attempts.length - 1 ? { ...a, ...patch } : a))

export function reducer(state, action) {
  switch (action.type) {
    case 'start/pending':
      return { ...state, pending: 'start', sentTopic: action.topic, error: null, streamFailed: false }

    case 'start/ok': {
      const { data } = action
      return {
        ...state,
        screen: 'run',
        runId: data.run_id,
        rootTopic: data.topic,
        topic: data.topic,
        depth: data.depth,
        path: [data.topic],
        attempts: [newAttempt()],
        breakthrough: null,
        history: [],
        pending: null,
        event: bump(state, 'descend'),
      }
    }

    // Streamed pieces of the current turn (see lib/stream.js).
    case 'turn/style':
    case 'turn/delta':
    case 'turn/explained':
    case 'turn/retrying':
    case 'turn/question': {
      const last = state.attempts[state.attempts.length - 1]
      if (!last) return state
      const turn = { ...last.turn }
      if (action.type === 'turn/style' && action.style) turn.style = action.style
      if (action.type === 'turn/delta') {
        if (turn.introStyle === undefined) turn.introStyle = turn.style
        turn.layer += action.text
      }
      if (action.type === 'turn/explained') {
        turn.explained = true
        // The backend sends the full text as the final word; trust it over the pieces.
        if (action.text) turn.layer = action.text
        if (turn.introStyle === undefined) turn.introStyle = turn.style
      }
      if (action.type === 'turn/retrying') turn.retrying = { attempt: action.attempt, max: action.max }
      if (action.type === 'turn/question') {
        turn.explained = true
        turn.question = action.question
        turn.options = action.options
        turn.retrying = null
        if (action.style) turn.style = action.style
      }
      return { ...state, attempts: updateLast(state.attempts, { turn }) }
    }

    case 'question/ready':
      return { ...state, attempts: updateLast(state.attempts, { ready: true }) }

    case 'answer/pending':
      return {
        ...state,
        pending: 'answer',
        error: null,
        attempts: updateLast(state.attempts, { chosen: action.index }),
      }

    case 'answer/wrong':
      return {
        ...state,
        pending: null,
        attempts: [
          ...updateLast(state.attempts, { result: 'wrong' }),
          newAttempt(), // the re-explanation streams in next
        ],
        event: bump(state, 'cave'),
      }

    case 'answer/right':
      return {
        ...state,
        pending: null,
        attempts: updateLast(state.attempts, { result: 'right' }),
        breakthrough: { artifact: action.artifact, tunnels: action.tunnels, stage: 'dig', chosen: null },
        history: [
          ...state.history,
          { depth: state.depth, topic: state.topic, caveIns: state.attempts.length - 1 },
        ],
        event: bump(state, 'break'),
      }

    case 'reveal':
      return state.breakthrough
        ? { ...state, breakthrough: { ...state.breakthrough, stage: 'reveal' } }
        : state

    case 'dig/pending':
      return {
        ...state,
        pending: 'dig',
        error: null,
        breakthrough: { ...state.breakthrough, chosen: action.index },
      }

    case 'dig/ok': {
      const { data } = action
      return {
        ...state,
        pending: null,
        depth: data.depth,
        topic: data.topic,
        path: [...state.path, data.topic],
        attempts: [newAttempt()],
        breakthrough: null,
        event: bump(state, 'descend'),
      }
    }

    case 'surface/ask':
      return { ...state, confirmingSurface: true }

    case 'surface/cancel':
      return { ...state, confirmingSurface: false }

    case 'surface/pending':
      return { ...state, pending: 'surface', confirmingSurface: false, error: null }

    case 'surface/ok':
      return {
        ...state,
        screen: 'end',
        pending: null,
        summary: action.summary,
        event: bump(state, 'surface'),
      }

    case 'fail': {
      if (action.lost) {
        return { ...initialState, runCount: state.runCount + 1, error: LOST_MESSAGE, errorId: state.errorId + 1 }
      }
      // A stream broke after the run (or new layer) had started: the current
      // turn can't finish, so mark it failed and offer a way on.
      if (action.stream && state.screen === 'run' && !state.pending) {
        const last = state.attempts[state.attempts.length - 1]
        return {
          ...state,
          attempts: last ? updateLast(state.attempts, { turn: { ...last.turn, failed: true, retrying: null } }) : state.attempts,
          error: action.message,
          errorId: state.errorId + 1,
          streamFailed: true,
        }
      }
      // Undo the optimistic part of whatever was pending so the player can retry.
      const undo = {
        start: { sentTopic: '' },
        answer: { attempts: updateLast(state.attempts, { chosen: null }) },
        dig: state.breakthrough ? { breakthrough: { ...state.breakthrough, chosen: null } } : {},
        surface: {},
      }[state.pending] ?? {}
      return { ...state, ...undo, pending: null, error: action.message, errorId: state.errorId + 1 }
    }

    case 'reset':
      return { ...initialState, runCount: state.runCount + 1 }

    default:
      return state
  }
}
