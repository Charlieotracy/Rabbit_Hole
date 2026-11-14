import { useEffect, useState } from 'react'

// Viewport height (one stratum per screen) and the horizon (sky height, set in
// tokens.css as --horizon, which changes on small screens).
function read() {
  const horizon = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--horizon'))
  return { vh: window.innerHeight, horizon: Number.isFinite(horizon) ? horizon : 560 }
}

export function useViewport() {
  const [viewport, setViewport] = useState(read)
  useEffect(() => {
    const onResize = () => setViewport(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return viewport
}
