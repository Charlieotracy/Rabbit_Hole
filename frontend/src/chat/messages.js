import { caveIntro, CHEERS, errorLine, pick, SURFACE_ASK, TUNNEL_PROMPTS, tunnelReply } from '../lib/lines.js'

// Turns the game state for the current layer into an ordered chat transcript.
// Each message has a stable `id` so the chat knows which ones are new (and
// should type out) and which were already shown.
//
// kinds: bunny | player | replies | typing | dig | artifact | tunnels | confirm
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
    add({ id: `question-${i}`, kind: 'bunny', emphasis: true, text: attempt.turn.question })

    if (attempt.chosen === null) {
      if (isCurrent && !breakthrough) add({ id: `replies-${i}`, kind: 'replies', options: attempt.turn.options })
    } else {
      add({ id: `answer-${i}`, kind: 'player', text: attempt.turn.options[attempt.chosen], result: attempt.result })
    }
  })

  if (pending === 'answer') msgs.push({ id: 'typing-answer', kind: 'typing' })

  if (breakthrough) {
    msgs.push({ id: 'cheer', kind: 'bunny', text: pick(CHEERS, depth) })
    if (breakthrough.stage === 'dig') {
      msgs.push({ id: 'dig', kind: 'dig' })
    } else {
      msgs.push({ id: 'artifact', kind: 'artifact', artifact: breakthrough.artifact })
      msgs.push({ id: 'tunnel-prompt', kind: 'bunny', text: pick(TUNNEL_PROMPTS, depth) })
      if (breakthrough.chosen === null) {
        msgs.push({ id: 'tunnels', kind: 'tunnels', tunnels: breakthrough.tunnels })
      } else {
        msgs.push({ id: 'tunnel-choice', kind: 'player', text: tunnelReply(breakthrough.tunnels[breakthrough.chosen]) })
        if (pending === 'dig') msgs.push({ id: 'typing-dig', kind: 'typing', digging: true })
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
