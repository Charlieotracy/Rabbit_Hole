// The game's state machine as a pure reducer (no React, no network), so it
// can be unit-tested with plain Node. useGame.js wires it to the API.
//
// screen:  'start' -> 'run' -> 'end' -> (reset) 'start'
// attempts: the current layer's turns, in order. The first is the original
//   explanation and question; each cave-in adds another. `chosen` is the
//   option the player picked and `result` is 'wrong' | 'right' once known.

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
  attempts: [], // current layer: [{ turn, chosen, result }]
  breakthrough: null, // { artifact, tunnels, stage: 'dig' | 'reveal', chosen }
  history: [], // cleared layers: [{ depth, topic, caveIns }]
  pending: null, // 'start' | 'answer' | 'dig' | 'surface'
  confirmingSurface: false,
  summary: null,
  error: null,
  errorId: 0,
  event: { type: null, id: 0 }, // last big moment ('cave' | 'break' | 'descend' | 'surface')
}

const bump = (state, type) => ({ type, id: state.event.id + 1 })

const updateLast = (attempts, patch) =>
  attempts.map((a, i) => (i === attempts.length - 1 ? { ...a, ...patch } : a))

export function reducer(state, action) {
  switch (action.type) {
    case 'start/pending':
      return { ...state, pending: 'start', sentTopic: action.topic, error: null }

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
        attempts: [{ turn: data.turn, chosen: null, result: null }],
        breakthrough: null,
        history: [],
        pending: null,
        event: bump(state, 'descend'),
      }
    }

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
          { turn: action.turn, chosen: null, result: null },
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
        attempts: [{ turn: data.turn, chosen: null, result: null }],
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
