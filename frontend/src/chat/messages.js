import { caveIntro, errorLine, RIGHT_ANSWER, SURFACE_ASK, TUNNEL_PROMPT } from '../lib/lines.js'

// Turns the game state for the current layer into an ordered chat transcript
// (oldest first). Everything is said by the bunny: buttons the player uses
// are attached to the bunny's message instead of being separate replies.
// Each message has a stable `id` so the chat knows which ones are new (and
// should type out) and which were already shown.
//
// kinds: bunny | question | typing
//   bunny.ready    - show the "Ready for a question?" button (after a pause)
//   bunny.tunnels  - show the three tunnels under it (bunny.chosenTunnel once picked)
//   bunny.confirm  - show "Yes, surface / Keep digging"
//
// Each attempt reads: explanation (+ Ready button) -> question with options.

export function buildMessages(game) {
  const msgs = []
  const { attempts, breakthrough, depth, topic, pending } = game

  attempts.forEach((attempt, i) => {
    const isCurrent = i === attempts.length - 1
    const ready = isCurrent && !attempt.ready && !breakthrough

    if (i === 0) {
      msgs.push({ id: 'explain-0', kind: 'bunny', label: `Layer ${depth} · ${topic}`, text: attempt.turn.layer, ready })
    } else {
      msgs.push({ id: `cave-${i}`, kind: 'bunny', variant: 'cave', text: caveIntro(attempt.turn.style, i - 1) })
      msgs.push({
        id: `explain-${i}`,
        kind: 'bunny',
        label: attempt.turn.style ? `Explained as: ${attempt.turn.style}` : 'Another angle',
        text: attempt.turn.layer,
        ready,
      })
    }

    if (attempt.ready) {
      msgs.push({
        id: `question-${i}`,
        kind: 'question',
        text: attempt.turn.question,
        options: attempt.turn.options,
        chosen: attempt.chosen,
        result: attempt.result,
        answerable: isCurrent && attempt.chosen === null && !breakthrough,
      })
    }
  })

  if (pending === 'answer') msgs.push({ id: 'typing-answer', kind: 'typing' })

  // Right answer: the bunny cheers while saying so, then after a pause
  // points out the tunnels.
  if (breakthrough) {
    msgs.push({ id: 'right', kind: 'bunny', text: RIGHT_ANSWER })
    if (breakthrough.stage === 'reveal') {
      msgs.push({
        id: 'tunnel-prompt',
        kind: 'bunny',
        text: TUNNEL_PROMPT,
        tunnels: breakthrough.tunnels,
        chosenTunnel: breakthrough.chosen,
      })
    }
  }

  if (game.confirmingSurface) msgs.push({ id: 'surface-ask', kind: 'bunny', text: SURFACE_ASK, confirm: true })
  if (pending === 'surface') msgs.push({ id: 'typing-surface', kind: 'typing' })

  if (game.error) {
    msgs.push({ id: `error-${game.errorId}`, kind: 'bunny', variant: 'cave', text: errorLine(game.error) })
  }

  return msgs
}
