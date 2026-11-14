// Everything the bunny says that doesn't come from the backend. Lists give a
// few variants; pick() chooses one by a stable seed (like the depth) so a
// line doesn't change on every re-render.

export const pick = (list, seed = 0) => list[Math.abs(seed) % list.length]

export const GREETING = 'Hi! What should we dig into today?'

export const startReply = (topic) => `Ooh, ${topic}! Grab a shovel, let's dig.`

const STYLE_PHRASES = {
  analogy: 'an analogy',
  'concrete example': 'a concrete example',
  'step by step': 'a step-by-step version',
}

export const caveIntro = (style, attempt) =>
  pick(
    [
      `Whoops, cave-in! Let's try that another way. Here's ${STYLE_PHRASES[style] ?? 'a different angle'}:`,
      `Rocks everywhere! No worries, let me explain it with ${STYLE_PHRASES[style] ?? 'a different angle'}:`,
      `That tunnel caved in. Let's shore it up with ${STYLE_PHRASES[style] ?? 'another approach'}:`,
    ],
    attempt,
  )

export const CHEERS = [
  'Yes! You broke through!',
  "That's it! The wall's giving way!",
  'Nailed it! Keep digging, keep digging!',
  'Crunch! We broke through!',
]

export const TUNNEL_PROMPTS = [
  'Three tunnels branch off from here. Which one should we take?',
  'Look, three new tunnels! Pick one and let’s go deeper.',
  'The ground splits three ways. Where to next?',
]

export const tunnelReply = (tunnel) => `Let's go: ${tunnel}`

export const SURFACE_ASK = 'Head back up to the surface?'

export const errorLine = (message) => `Hmm, the tunnel collapsed (${message}). Want to try that again?`

export function endHeadline(depth, topic) {
  if (depth <= 1) return `We poked into ${topic}. Every dig starts somewhere!`
  if (depth <= 3) return `Nice dig! We went ${depth} layers deep into ${topic}.`
  return `What a dig! We went ${depth} layers deep into ${topic}!`
}
