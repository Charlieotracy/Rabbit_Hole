// All backend calls live here. Components must never call fetch directly.
//
// Steps that generate content (start a run, dig, cave-in) stream, following
// API.md's "streaming turn delivery": the POST asks for `"stream": true` and
// returns straight away, then a GET opens a server-sent-event stream with
// the explanation (as the model writes it) and then the question. Each piece
// reaches the game as onEvent(name, data), using the events in lib/stream.js.
//
// If the backend doesn't stream yet, it ignores `stream` and replies with
// the whole turn as JSON; the same events are produced from that, so the
// game works either way.

import { caveJsonEvents, digJsonEvents, normalizeEvent, runJsonEvents, sseParser } from './lib/stream'

// Change to "/api" (and the Vite proxy) if the backend adds a prefix later.
export const API_BASE = ''

// Dev-only knobs, set in frontend/.env.local (restart `npm run dev` after):
//   VITE_FAKE_DELAY_MS=2000   delay every request, to design loading states
//   VITE_FAKE_STREAM=1        when the backend answers with plain JSON, drip
//                             the explanation in word by word and hold the
//                             question back, to build against streaming
//                             before the backend streams
const FAKE_DELAY_MS = Number(import.meta.env.VITE_FAKE_DELAY_MS) || 0
const FAKE_STREAM = import.meta.env.VITE_FAKE_STREAM === '1'
const FAKE_WORD_MS = 45
const FAKE_QUESTION_MS = 3000

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

async function send(method, path, body, signal) {
  const options = { method, headers: { Accept: 'text/event-stream, application/json' }, signal }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(`${API_BASE}${path}`, options)
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const data = await response.json()
      // 4xx errors use {detail}; 503 (LLM generation failed) uses {error}. See API.md.
      if (typeof data.error === 'string') detail = data.error
      else if (typeof data.detail === 'string') detail = data.detail
      else if (data.detail !== undefined) detail = JSON.stringify(data.detail)
    } catch {
      // no JSON body; keep the default message
    }
    throw new ApiError(response.status, detail)
  }
  return response
}

async function request(method, path, body) {
  return (await send(method, path, body)).json()
}

const isStream = (response) => (response.headers.get('content-type') || '').includes('text/event-stream')

// A failure partway through a stream. `explanationShown` says whether some
// of the explanation already reached the player (it can't be taken back).
export class StreamError extends ApiError {
  constructor(message, explanationShown) {
    super(503, message)
    this.name = 'StreamError'
    this.explanationShown = explanationShown
  }
}

// Reads a server-sent-event response, passing normalized events to onEvent.
// Per API.md, `done` or `error` ends it; a stream that just stops without
// either counts as a dropped connection.
async function readStream(response, onEvent) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let finished = false
  let shown = false
  const feed = sseParser((name, data) => {
    const event = normalizeEvent(name, data)
    if (!event || finished) return
    if (event[0] === 'error') {
      finished = true
      throw new StreamError(event[1].error, event[1].explanation_shown || shown)
    }
    if (event[0] === 'delta' && event[1].text) shown = true
    if (event[0] === 'end') finished = true
    onEvent(...event)
  })
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    feed(decoder.decode(value, { stream: true }))
    if (finished) break
  }
  if (!finished) feed(decoder.decode() + '\n\n')
  if (!finished) throw new StreamError('The connection dropped partway through. Want to try again?', shown)
}

// Opens a GET event stream (e.g. /runs/{id}/layer).
async function openStream(path, onEvent, signal) {
  const response = await send('GET', path, undefined, signal)
  if (!isStream(response)) throw new StreamError('Expected a stream from the server.', false)
  return readStream(response, onEvent)
}

// Replays events built from a JSON response; with VITE_FAKE_STREAM it drips
// the explanation word by word and delays the question, like a real stream.
async function replay(events, onEvent, signal) {
  for (const [name, data] of events) {
    if (FAKE_STREAM && name === 'delta') {
      const words = data.text.split(/(?<=\s)/)
      for (const word of words) {
        onEvent('delta', { text: word })
        await sleep(FAKE_WORD_MS, signal)
      }
    } else {
      if (FAKE_STREAM && name === 'question') await sleep(FAKE_QUESTION_MS, signal)
      onEvent(name, data)
    }
  }
}

const runPath = (runId) => `/runs/${encodeURIComponent(runId)}`

// Starts a run. Streaming backend: POST returns {run_id, depth, topic}, then
// GET /runs/{id}/layer streams the first layer. Older backend: POST returns
// everything (with `turn`) at once.
export async function createRun(topic, onEvent, signal) {
  await sleep(FAKE_DELAY_MS, signal)
  const data = await (await send('POST', '/runs', { topic, stream: true }, signal)).json()
  if (data.turn) return replay(runJsonEvents(data), onEvent, signal)
  onEvent('run', { run_id: data.run_id, depth: data.depth, topic: data.topic })
  return openStream(`${runPath(data.run_id)}/layer`, onEvent, signal)
}

// Digs into a tunnel: POST returns {depth, topic}, then /layer streams it.
export async function dig(runId, tunnelIndex, onEvent, signal) {
  await sleep(FAKE_DELAY_MS, signal)
  const data = await (await send('POST', `${runPath(runId)}/dig`, { tunnel_index: tunnelIndex, stream: true }, signal)).json()
  if (data.turn) return replay(digJsonEvents(data), onEvent, signal)
  onEvent('layer', { depth: data.depth, topic: data.topic })
  return openStream(`${runPath(runId)}/layer`, onEvent, signal)
}

// Right or wrong, returned straight away: {correct: true, artifact, tunnels}
// or {correct: false}. (The older API puts the whole cave-in in here too.)
export async function submitAnswer(runId, optionIndex) {
  await sleep(FAKE_DELAY_MS)
  return request('POST', `${runPath(runId)}/answer`, { option_index: optionIndex, stream: true })
}

// Streams the re-explanation after a wrong answer from GET /cave-in, or
// replays it if the answer response already contained it (older API).
export async function caveIn(runId, answerData, onEvent, signal) {
  if (answerData?.cave_in) return replay(caveJsonEvents(answerData.cave_in), onEvent, signal)
  onEvent('cave_in', { style: null })
  return openStream(`${runPath(runId)}/cave-in`, onEvent, signal)
}

export function getRun(runId) {
  return request('GET', runPath(runId))
}
