// True when the player asked their OS for less motion.
export const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
