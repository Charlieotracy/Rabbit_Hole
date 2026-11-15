import { caveIntro, errorLine, READY_PROMPT, RIGHT_ANSWER, SURFACE_ASK, TUNNEL_PROMPT, tunnelReply } from '../lib/lines.js'

// Turns the game state for the current layer into an ordered chat transcript.
// Each message has a stable `id` so the chat knows which ones are new (and
// should type out) and which were already shown. A `delay` (ms) holds a
// message back for a moment after the previous one finishes.
//
// kinds: bunny | ready | question | player | typing | tunnels | confirm
//
// Each attempt reads: explanation -> (pause) "Ready for a question?" button
// -> question with its options in one bubble -> the player's answer.

const READY_DELAY_MS = 2000

export function buildMessages(game) {
  const msgs = []
  const { attempts, breakthrough, depth, topic, pending } = game

  attempts.forEach((attempt, i) => {
    const isCurrent = i === attempts.length - 1
    // Earlier attempts (before a cave-in) stay visible but dimmed.
    const old = !isCurrent
    const add = (m) => msgs.push({ ...m, old })

    if (i === 0) {
      add({ id: 'explain-0', kind: 'bunny', label: `Layer ${depth} · ${topic}`, text: attempt.turn.layer })
    } else {
      add({ id: `cave-${i}`, kind: 'bunny', variant: 'cave', text: caveIntro(attempt.turn.style, i - 1) })
      add({
        id: `explain-${i}`,
        kind: 'bunny',
        label: attempt.turn.style ? `Explained as: ${attempt.turn.style}` : 'Another angle',
        text: attempt.turn.layer,
      })
    }

    if (!attempt.ready) {
      if (isCurrent && !breakthrough) add({ id: `ready-${i}`, kind: 'ready', label: READY_PROMPT, delay: READY_DELAY_MS })
      return
    }

    add({
      id: `question-${i}`,
      kind: 'question',
      text: attempt.turn.question,
      options: attempt.turn.options,
      chosen: attempt.chosen,
      result: attempt.result,
      answerable: isCurrent && attempt.chosen === null && !breakthrough,
    })

    if (attempt.chosen !== null) {
      add({ id: `answer-${i}`, kind: 'player', text: attempt.turn.options[attempt.chosen], result: attempt.result })
    }
  })

  if (pending === 'answer') msgs.push({ id: 'typing-answer', kind: 'typing' })

  // Right answer: the bunny digs down (avatar animation) while saying so,
  // then after a pause points out the tunnels.
  if (breakthrough) {
    msgs.push({ id: 'right', kind: 'bunny', text: RIGHT_ANSWER })
    if (breakthrough.stage === 'reveal') {
      msgs.push({ id: 'tunnel-prompt', kind: 'bunny', text: TUNNEL_PROMPT })
      if (breakthrough.chosen === null) {
        msgs.push({ id: 'tunnels', kind: 'tunnels', tunnels: breakthrough.tunnels })
      } else {
        msgs.push({ id: 'tunnel-choice', kind: 'player', text: tunnelReply(breakthrough.tunnels[breakthrough.chosen]) })
      }
    }
  }

  if (game.confirmingSurface) {
    msgs.push({ id: 'surface-ask', kind: 'bunny', text: SURFACE_ASK })
    msgs.push({ id: 'surface-confirm', kind: 'confirm' })
  }
  if (pending === 'surface') msgs.push({ id: 'typing-surface', kind: 'typing' })

  if (game.error) {
    msgs.push({ id: `error-${game.errorId}`, kind: 'bunny', variant: 'cave', text: errorLine(game.error) })
  }

  return msgs
}
