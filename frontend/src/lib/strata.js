// What the ground looks like at each depth. Layer 1 is just under the grass.
// Colours darken as you go down, then turn hot near the core.

const STRATA = [
  { name: 'Topsoil', color: '#6b4a2f', props: ['root', 'worm', 'pebble'] },
  { name: 'Clay', color: '#7a4630', props: ['pebble', 'pebble', 'fossil'] },
  { name: 'Sandstone', color: '#6a5034', props: ['fossil', 'pebble', 'bone'] },
  { name: 'Shale', color: '#45393a', props: ['pebble', 'fossil', 'crystal'] },
  { name: 'Bedrock', color: '#302a30', props: ['crystal', 'pebble'] },
  { name: 'Deep rock', color: '#231d27', props: ['crystal', 'crystal', 'pebble'] },
  { name: 'Mantle', color: '#3a1a1c', props: ['ember', 'crystal'] },
  { name: 'Core', color: '#4f1715', props: ['ember', 'ember'] },
]

export function stratum(depth) {
  const i = Math.max(0, Math.min(depth - 1, STRATA.length - 1))
  const base = STRATA[i]
  // Past the core, keep counting so very deep runs still feel like progress.
  const beyond = depth > STRATA.length ? ` ${depth - STRATA.length + 1}` : ''
  return { ...base, name: `${base.name}${beyond}` }
}

// Light text and the bunny's headlamp only matter once it's dark enough.
export const isDark = (depth) => depth >= 4
