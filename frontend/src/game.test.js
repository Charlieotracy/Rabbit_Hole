import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMessages } from './chat/messages.js'
import { layoutTree } from './end/layout.js'
import { initialState, reducer } from './gameReducer.js'
import { shareText } from './lib/share.js'

const turn = (n) => ({ layer: `Layer text ${n}`, question: `Question ${n}?`, options: ['A', 'B', 'C', 'D'] })
const run = (...actions) => actions.reduce(reducer, initialState)
const started = [
  { type: 'start/pending', topic: 'black holes' },
  { type: 'start/ok', data: { run_id: 'r1', depth: 1, topic: 'Black holes', turn: turn(1) } },
]
const kinds = (game) => buildMessages({ ...game, caveInsHere: 0 }).map((m) => m.kind)

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

test('a wrong answer records the pick and adds a cave-in attempt', () => {
  const s = run(...started, { type: 'answer/pending', index: 2 }, { type: 'answer/wrong', turn: { ...turn(2), style: 'analogy' } })
  assert.equal(s.attempts.length, 2)
  assert.deepEqual([s.attempts[0].chosen, s.attempts[0].result], [2, 'wrong'])
  assert.equal(s.attempts[1].chosen, null)
  assert.equal(s.event.type, 'cave')
})

test('a right answer starts the break-through and logs the layer', () => {
  const s = run(
    ...started,
    { type: 'answer/pending', index: 0 },
    { type: 'answer/wrong', turn: turn(2) },
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
    { type: 'dig/ok', data: { depth: 2, topic: 'y', turn: turn(3) } },
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

test('chat shows explanation, question and reply chips for a fresh layer', () => {
  assert.deepEqual(kinds(run(...started)), ['bunny', 'bunny', 'replies'])
})

test('chat after a cave-in dims the old attempt and asks again', () => {
  const s = run(...started, { type: 'answer/pending', index: 2 }, { type: 'answer/wrong', turn: { ...turn(2), style: 'analogy' } })
  const msgs = buildMessages(s)
  assert.deepEqual(
    msgs.map((m) => m.kind),
    ['bunny', 'bunny', 'player', 'bunny', 'bunny', 'bunny', 'replies'],
  )
  assert.equal(msgs[2].result, 'wrong')
  assert.ok(msgs.slice(0, 3).every((m) => m.old))
  assert.match(msgs[3].text, /analogy/)
  assert.equal(msgs[4].label, 'Explained as: analogy')
})

test('chat shows the dig, then the artifact and tunnels', () => {
  const broke = run(
    ...started,
    { type: 'answer/pending', index: 0 },
    { type: 'answer/right', artifact: { name: 'Photo', icon: 'camera', depth: 1 }, tunnels: ['x', 'y', 'z'] },
  )
  assert.deepEqual(kinds(broke).slice(-2), ['bunny', 'dig'])
  assert.deepEqual(kinds(reducer(broke, { type: 'reveal' })).slice(-3), ['artifact', 'bunny', 'tunnels'])
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
