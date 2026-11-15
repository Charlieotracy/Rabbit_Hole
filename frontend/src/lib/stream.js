// Turning backend responses into one internal stream of turn events.
// Pure functions (no fetch, no React) so they can be unit-tested with Node.
// The backend's streaming format is specified in API.md ("Proposal:
// streaming turn delivery").
//
// Internal events the game understands:
//   run       {run_id, depth, topic}   a new run started
//   layer     {depth, topic}           we dug into a new layer
//   cave_in   {style}                  a re-explanation is starting (style may be unknown yet)
//   delta     {text}                   more explanation text
//   explained {text?}                  the explanation is final (text = the full, authoritative copy)
//   retrying  {attempt, max_attempts}  the question was rejected; another attempt is under way
//   question  {question, options, style?}
//   end                                the turn completed successfully
//   error     {error, explanation_shown}

// ---------------------------------------------------------------------------
// Server-sent events: "event: name\ndata: {...}\n\n" blocks.

// Feeds text chunks in; calls onBlock(name, data) for each complete event.
// Returns a function to call with each new chunk.
export function sseParser(onBlock) {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, '\n')
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let name = 'message'
      const dataLines = []
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue // comment / keep-alive ping
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') name = value
        else if (field === 'data') dataLines.push(value)
      }
      if (!dataLines.length && name === 'message') continue
      const raw = dataLines.join('\n')
      let data = raw
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        // not JSON; pass the raw string through
      }
      onBlock(name, data)
    }
  }
}

// ---------------------------------------------------------------------------
// The backend's event names -> ours. This is the one place to edit if the
// backend's streaming format uses different names or fields (see API.md).
export function normalizeEvent(name, data) {
  switch (name) {
    case 'run':
      return ['run', { run_id: data.run_id, depth: data.depth, topic: data.topic }]
    case 'layer':
      return ['layer', { depth: data.depth, topic: data.topic }]
    case 'cave_in':
      return ['cave_in', { style: data.style ?? null }]
    case 'text':
    case 'explanation':
    case 'delta':
      return ['delta', { text: typeof data === 'string' ? data : (data.delta ?? data.text ?? '') }]
    case 'explanation_committed':
    case 'explanation_end':
    case 'explained':
      return ['explained', typeof data?.text === 'string' ? { text: data.text } : {}]
    case 'retrying':
      return ['retrying', { attempt: data.attempt, max_attempts: data.max_attempts }]
    case 'question':
      return ['question', { question: data.question ?? data.text, options: data.options, style: data.style }]
    case 'done':
    case 'end':
      return ['end', {}]
    case 'error':
      return ['error', { error: data.error ?? data.detail ?? String(data), explanation_shown: Boolean(data.explanation_shown) }]
    default:
      return null // unknown events (and future additions) are ignored
  }
}

// ---------------------------------------------------------------------------
// The older all-at-once JSON responses, expressed as the same events, so the
// game works the same whether or not the backend streams.

export function turnEvents(turn) {
  return [
    ['delta', { text: turn.layer }],
    ['explained', {}],
    ['question', { question: turn.question, options: turn.options }],
    ['end', {}],
  ]
}

export function runJsonEvents(data) {
  return [['run', { run_id: data.run_id, depth: data.depth, topic: data.topic }], ...turnEvents(data.turn)]
}

export function digJsonEvents(data) {
  return [['layer', { depth: data.depth, topic: data.topic }], ...turnEvents(data.turn)]
}

export function caveJsonEvents(caveIn) {
  return [['cave_in', { style: caveIn.style ?? null }], ...turnEvents(caveIn)]
}
