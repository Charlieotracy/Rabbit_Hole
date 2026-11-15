import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMessages } from './chat/messages.js'
import { layoutTree } from './end/layout.js'
import { initialState, reducer } from './gameReducer.js'
import { shareText } from './lib/share.js'
import { normalizeEvent, runJsonEvents, sseParser } from './lib/stream.js'

const turn = (n) => ({ layer: `Layer text ${n}`, question: `Question ${n}?`, options: ['A', 'B', 'C', 'D'] })
const run = (...actions) => actions.reduce(reducer, initialState)
// A turn as it streams in: (style), explanation in two pieces, done, then the question.
const streamTurn = (t) => [
  ...(t.style ? [{ type: 'turn/style', style: t.style }] : []),
  { type: 'turn/delta', text: t.layer.slice(0, 5) },
  { type: 'turn/delta', text: t.layer.slice(5) },
  { type: 'turn/explained' },
  { type: 'turn/question', question: t.question, options: t.options },
]
const started = [
  { type: 'start/pending', topic: 'black holes' },
  { type: 'start/ok', data: { run_id: 'r1', depth: 1, topic: 'Black holes' } },
  ...streamTurn(turn(1)),
]
const ready = { type: 'question/ready' }

test('starting a run moves to the first layer', () => {
  const s = run(...started)
  assert.equal(s.screen, 'run')
  assert.equal(s.depth, 1)
  assert.equal(s.sentTopic, 'black holes')
  assert.equal(s.rootTopic, 'Black holes')
  assert.deepEqual(s.path, ['Black holes'])
  assert.equal(s.attempts.length, 1)
  assert.equal(s.event.type, 'descend')
})

test('clicking ready marks the current attempt ready', () => {
  const s = run(...started, ready)
  assert.equal(s.attempts[0].ready, true)
})

test('a wrong answer records the pick and adds a cave-in attempt', () => {
  const s = run(...started, ready, { type: 'answer/pending', index: 2 }, { type: 'answer/wrong' }, ...streamTurn({ ...turn(2), style: 'analogy' }))
  assert.equal(s.attempts.length, 2)
  assert.deepEqual([s.attempts[0].chosen, s.attempts[0].result], [2, 'wrong'])
  assert.equal(s.attempts[1].chosen, null)
  assert.equal(s.attempts[1].ready, false)
  assert.equal(s.event.type, 'cave')
})

test('a right answer starts the break-through and logs the layer', () => {
  const s = run(
    ...started,
    { type: 'answer/pending', index: 0 },
    { type: 'answer/wrong' }, ...streamTurn(turn(2)),
    { type: 'answer/pending', index: 1 },
    { type: 'answer/right', artifact: { name: 'Photo', icon: 'camera', depth: 1 }, tunnels: ['x', 'y', 'z'] },
  )
  assert.equal(s.breakthrough.stage, 'dig')
  assert.deepEqual(s.history, [{ depth: 1, topic: 'Black holes', caveIns: 1 }])
})

test('digging a tunnel goes one layer deeper with a fresh chat', () => {
  const s = run(
    ...started,
    { type: 'answer/pending', index: 0 },
    { type: 'answer/right', artifact: { name: 'Photo', icon: 'camera', depth: 1 }, tunnels: ['x', 'y', 'z'] },
    { type: 'reveal' },
    { type: 'dig/pending', index: 1 },
    { type: 'dig/ok', data: { depth: 2, topic: 'y' } },
    ...streamTurn(turn(3)),
  )
  assert.equal(s.depth, 2)
  assert.deepEqual(s.path, ['Black holes', 'y'])
  assert.equal(s.attempts.length, 1)
  assert.equal(s.breakthrough, null)
})

test('a failed answer request lets the player pick again', () => {
  const s = run(...started, { type: 'answer/pending', index: 3 }, { type: 'fail', message: 'boom', lost: false })
  assert.equal(s.attempts[0].chosen, null)
  assert.equal(s.pending, null)
  assert.equal(s.error, 'boom')
})

test('a lost run (404) resets to the start screen with a message', () => {
  const s = run(...started, { type: 'answer/pending', index: 0 }, { type: 'fail', message: 'run not found', lost: true })
  assert.equal(s.screen, 'start')
  assert.equal(s.runId, null)
  assert.match(s.error, /lost/)
  assert.equal(s.runCount, 1)
})

test('a fresh layer is one bunny message with the Ready button attached', () => {
  const msgs = buildMessages(run(...started))
  assert.deepEqual(msgs.map((m) => m.kind), ['bunny'])
  assert.equal(msgs[0].ready, true)
})

test('after Ready, the question and its options come in one bubble', () => {
  const msgs = buildMessages(run(...started, ready))
  assert.deepEqual(msgs.map((m) => m.kind), ['bunny', 'question'])
  assert.equal(msgs[0].ready, false)
  assert.deepEqual(msgs[1].options, ['A', 'B', 'C', 'D'])
  assert.equal(msgs[1].answerable, true)
})

test('after a cave-in: the pick stays on the old question, then re-explanation with Ready', () => {
  const s = run(...started, ready, { type: 'answer/pending', index: 2 }, { type: 'answer/wrong' }, ...streamTurn({ ...turn(2), style: 'analogy' }))
  const msgs = buildMessages(s)
  assert.deepEqual(msgs.map((m) => m.kind), ['bunny', 'question', 'bunny', 'bunny'])
  assert.deepEqual([msgs[1].chosen, msgs[1].result, msgs[1].answerable], [2, 'wrong', false])
  assert.match(msgs[2].text, /analogy/)
  assert.equal(msgs[3].label, 'Explained as: analogy')
  assert.equal(msgs[3].ready, true)
})

test('every message comes from the bunny (no player bubbles)', () => {
  const s = run(
    ...started,
    ready,
    { type: 'answer/pending', index: 0 },
    { type: 'answer/right', artifact: { name: 'Photo', icon: 'camera', depth: 1 }, tunnels: ['x', 'y', 'z'] },
    { type: 'reveal' },
    { type: 'dig/pending', index: 1 },
  )
  assert.ok(buildMessages(s).every((m) => ['bunny', 'question', 'typing'].includes(m.kind)))
})

test('a right answer says so, then after the dig the tunnels come with the prompt', () => {
  const broke = run(
    ...started,
    ready,
    { type: 'answer/pending', index: 0 },
    { type: 'answer/right', artifact: { name: 'Photo', icon: 'camera', depth: 1 }, tunnels: ['x', 'y', 'z'] },
  )
  assert.equal(buildMessages(broke).at(-1).text, 'You got it right!')
  const after = buildMessages(reducer(broke, { type: 'reveal' })).at(-1)
  assert.equal(after.text, "Look, three new tunnels! Pick one and let's go deeper!")
  assert.deepEqual(after.tunnels, ['x', 'y', 'z'])
  assert.equal(after.chosenTunnel, null)
})

test('share text counts first tries and draws one square per cleared layer', () => {
  const text = shareText({
    topic: 'black holes',
    depth: 4,
    history: [{ caveIns: 0 }, { caveIns: 2 }, { caveIns: 0 }],
  })
  assert.equal(text, '🐇 Rabbit Hole: black holes\n⛏️ 4 layers deep · 2/3 first try\n🟫🟥🟫')
})

test('tunnel map places siblings side by side, one row per layer', () => {
  const { nodes, edges } = layoutTree([
    { id: 'n1', parent_id: null, topic: 'a', depth: 1, status: 'dug', cave_ins: 0 },
    { id: 'n2', parent_id: 'n1', topic: 'b', depth: 2, status: 'skipped', cave_ins: 0 },
    { id: 'n3', parent_id: 'n1', topic: 'c', depth: 2, status: 'dug', cave_ins: 1 },
    { id: 'n4', parent_id: 'n1', topic: 'd', depth: 2, status: 'skipped', cave_ins: 0 },
  ])
  assert.equal(nodes.length, 4)
  assert.equal(edges.length, 3)
  const row2 = nodes.filter((n) => n.depth === 2)
  assert.equal(new Set(row2.map((n) => n.y)).size, 1)
  assert.equal(new Set(row2.map((n) => n.x)).size, 3)
})

// ---------------------------------------------------------------- streaming

test('a streaming turn: typing dots, then growing text, then Ready once complete', () => {
  const opened = run({ type: 'start/pending', topic: 'jazz' }, { type: 'start/ok', data: { run_id: 'r', depth: 1, topic: 'Jazz' } })
  assert.deepEqual(buildMessages(opened).map((m) => m.kind), ['typing'])

  const partway = run(
    { type: 'start/pending', topic: 'jazz' },
    { type: 'start/ok', data: { run_id: 'r', depth: 1, topic: 'Jazz' } },
    { type: 'turn/delta', text: 'Jazz began ' },
    { type: 'turn/delta', text: 'in New Orleans.' },
  )
  const [explain] = buildMessages(partway)
  assert.equal(explain.text, 'Jazz began in New Orleans.')
  assert.equal(explain.streaming, true)
  assert.equal(explain.ready, false)

  const complete = reducer(partway, { type: 'turn/explained' })
  assert.deepEqual([buildMessages(complete)[0].streaming, buildMessages(complete)[0].ready], [false, true])
})

test('clicking Ready before the question arrives shows typing until it lands', () => {
  const base = [
    { type: 'start/pending', topic: 'jazz' },
    { type: 'start/ok', data: { run_id: 'r', depth: 1, topic: 'Jazz' } },
    { type: 'turn/delta', text: 'Text.' },
    { type: 'turn/explained' },
    ready,
  ]
  assert.deepEqual(buildMessages(run(...base)).map((m) => m.kind), ['bunny', 'typing'])
  const landed = run(...base, { type: 'turn/question', question: 'Q?', options: ['a', 'b', 'c', 'd'] })
  assert.deepEqual(buildMessages(landed).map((m) => m.kind), ['bunny', 'question'])
})

test('a wrong answer shows typing until the cave-in starts streaming', () => {
  const s = run(...started, ready, { type: 'answer/pending', index: 1 }, { type: 'answer/wrong' })
  assert.deepEqual(buildMessages(s).map((m) => m.kind), ['bunny', 'question', 'typing'])
  const styled = reducer(s, { type: 'turn/style', style: 'analogy' })
  assert.deepEqual(buildMessages(styled).map((m) => m.kind), ['bunny', 'question', 'bunny', 'typing'])
})

test('SSE parser handles chunks split anywhere, CRLF, comments and multi-line data', () => {
  const got = []
  const feed = sseParser((name, data) => got.push([name, data]))
  feed(': keep-alive\r\n\r\nevent: explan')
  feed('ation\ndata: {"delta": "Hel')
  feed('lo"}\n\nevent: question\ndata: {"question": "Q?",\ndata: "options": ["a"]}\n\n')
  assert.deepEqual(got, [
    ['explanation', { delta: 'Hello' }],
    ['question', { question: 'Q?', options: ['a'] }],
  ])
})

test("Sean's streaming event names (API.md) map onto the game events", () => {
  assert.deepEqual(normalizeEvent('text', { delta: 'hi' }), ['delta', { text: 'hi' }])
  assert.deepEqual(normalizeEvent('explanation_committed', { text: 'full' }), ['explained', { text: 'full' }])
  assert.deepEqual(normalizeEvent('retrying', { reason: 'x', attempt: 2, max_attempts: 3 }), [
    'retrying',
    { attempt: 2, max_attempts: 3 },
  ])
  assert.deepEqual(normalizeEvent('question', { question: 'Q?', options: ['a'], style: 'analogy' }), [
    'question',
    { question: 'Q?', options: ['a'], style: 'analogy' },
  ])
  assert.deepEqual(normalizeEvent('done', {}), ['end', {}])
  assert.deepEqual(normalizeEvent('error', { error: 'boom', explanation_shown: true }), [
    'error',
    { error: 'boom', explanation_shown: true },
  ])
  assert.equal(normalizeEvent('something_new', {}), null)
})

test('the committed explanation text wins over the streamed pieces', () => {
  const s = run(
    { type: 'start/pending', topic: 'jazz' },
    { type: 'start/ok', data: { run_id: 'r', depth: 1, topic: 'Jazz' } },
    { type: 'turn/delta', text: 'Jazz bega' },
    { type: 'turn/explained', text: 'Jazz began in New Orleans.' },
  )
  assert.equal(s.attempts[0].turn.layer, 'Jazz began in New Orleans.')
})

test('while the question is being retried the bunny says it is still working', () => {
  const s = run(
    { type: 'start/pending', topic: 'jazz' },
    { type: 'start/ok', data: { run_id: 'r', depth: 1, topic: 'Jazz' } },
    { type: 'turn/delta', text: 'Text.' },
    { type: 'turn/explained' },
    ready,
    { type: 'turn/retrying', attempt: 2, max: 3 },
  )
  const waiting = buildMessages(s).at(-1)
  assert.equal(waiting.kind, 'typing')
  assert.match(waiting.note, /Still working/)
})

test('a cave-in whose style only arrives with the question keeps a stable intro line', () => {
  const s = run(...started, ready, { type: 'answer/pending', index: 1 }, { type: 'answer/wrong' }, { type: 'turn/delta', text: 'Picture it.' })
  const intro = buildMessages(s)[2].text
  const later = reducer(s, { type: 'turn/question', question: 'Q?', options: ['a', 'b', 'c', 'd'], style: 'analogy' })
  assert.equal(buildMessages(later)[2].text, intro)
  assert.equal(buildMessages(later)[3].label, 'Explained as: analogy')
})

test('a broken stream marks the turn failed and offers a way on', () => {
  const s = run(
    { type: 'start/pending', topic: 'jazz' },
    { type: 'start/ok', data: { run_id: 'r', depth: 1, topic: 'Jazz' } },
    { type: 'turn/delta', text: 'Half an expla' },
    { type: 'fail', message: 'dropped', stream: true },
  )
  assert.equal(s.attempts[0].turn.failed, true)
  const msgs = buildMessages(s)
  assert.equal(msgs.at(-1).recover, 'retry-start') // first layer: start the same dig again
  assert.ok(!msgs.some((m) => m.ready)) // no Ready button: no question is coming
})

test('a plain JSON response (non-streaming backend) becomes the same events', () => {
  const events = runJsonEvents({ run_id: 'r', depth: 1, topic: 'Jazz', turn: turn(1) })
  assert.deepEqual(events.map(([name]) => name), ['run', 'delta', 'explained', 'question', 'end'])
  assert.equal(events[1][1].text, 'Layer text 1')
})
