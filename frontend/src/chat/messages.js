import { caveIntro, errorLine, QUESTION_RETRYING, RIGHT_ANSWER, STREAM_FAILED, SURFACE_ASK, TUNNEL_PROMPT } from '../lib/lines.js'

// Turns the game state for the current layer into an ordered chat transcript
// (oldest first). Everything is said by the bunny: buttons the player uses
// are attached to the bunny's message instead of being separate replies.
// Each message has a stable `id` so the chat knows which ones are new (and
// should type out) and which were already shown.
//
// kinds: bunny | question | typing
//   bunny.streaming - the text is still arriving (keep typing, don't finish)
//   bunny.ready    - show the "Ready for a question?" button (after a pause)
//   bunny.tunnels  - show the three tunnels under it (bunny.chosenTunnel once picked)
//   bunny.confirm  - show "Yes, surface / Keep digging"
//   bunny.recover  - after a broken stream: 'retry-start' or 'surface' button
//   typing.note    - small text under the dots (e.g. while a question is retried)
//
// Each attempt reads: explanation (+ Ready button) -> question with options.
// Turns stream in from the backend, so parts may still be missing: those
// show as the bunny's typing dots until they arrive.

export function buildMessages(game) {
  const msgs = []
  const { attempts, breakthrough, depth, topic, pending } = game

  attempts.forEach((attempt, i) => {
    const { turn } = attempt
    const isCurrent = i === attempts.length - 1
    // The Ready button waits for the whole explanation to arrive (and never
    // shows if the stream broke, since no question is coming).
    const ready = isCurrent && !attempt.ready && !breakthrough && turn.explained && !turn.failed

    if (i > 0) {
      // Cave-in: say so as soon as the re-explanation style is known.
      if (turn.style || turn.layer) {
        const style = turn.introStyle === undefined ? turn.style : turn.introStyle
        msgs.push({ id: `cave-${i}`, kind: 'bunny', variant: 'cave', text: caveIntro(style, i - 1) })
      } else {
        if (!turn.failed) msgs.push({ id: `typing-cave-${i}`, kind: 'typing' })
        return
      }
    }

    // The explanation streams in: typing dots until the first words arrive,
    // then a bubble whose text grows as more comes in.
    if (!turn.layer) {
      if (!turn.failed) msgs.push({ id: `typing-explain-${i}`, kind: 'typing' })
      return
    }
    msgs.push({
      id: `explain-${i}`,
      kind: 'bunny',
      label: i === 0 ? `Layer ${depth} · ${topic}` : turn.style ? `Explained as: ${turn.style}` : 'Another angle',
      text: turn.layer,
      streaming: !turn.explained,
      ready,
    })

    if (attempt.ready) {
      // Usually the question is long since here (it arrives while you read);
      // if not, the bunny "types" until it lands.
      if (!turn.question) {
        if (!turn.failed) {
          msgs.push({ id: `typing-question-${i}`, kind: 'typing', note: turn.retrying ? QUESTION_RETRYING : null })
        }
        return
      }
      msgs.push({
        id: `question-${i}`,
        kind: 'question',
        text: turn.question,
        options: turn.options,
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
    if (game.streamFailed) {
      // The current turn can't finish. On the very first layer we can simply
      // start the same dig again; otherwise head back up (progress is kept).
      const firstLayer = depth === 1 && attempts.length === 1
      msgs.push({
        id: `error-${game.errorId}`,
        kind: 'bunny',
        variant: 'cave',
        text: STREAM_FAILED,
        recover: firstLayer ? 'retry-start' : 'surface',
      })
    } else {
      msgs.push({ id: `error-${game.errorId}`, kind: 'bunny', variant: 'cave', text: errorLine(game.error) })
    }
  }

  return msgs
}
