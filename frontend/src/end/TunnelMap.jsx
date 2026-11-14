import { layoutTree, ROW } from './layout'
import { stratum } from '../lib/strata'

// The run drawn as a cross-section of ground: one band per layer, the dug
// path as a bright tunnel, skipped tunnels as short dim stubs, and little
// rock piles where the player caved in.

const MAX_LABEL = 20

const short = (text) => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text)

export default function TunnelMap({ map }) {
  const { nodes, edges } = layoutTree(map)
  if (nodes.length === 0) return null

  const xs = nodes.map((n) => n.x)
  const minX = Math.min(...xs) - 100
  const width = Math.max(...xs) + 100 - minX
  const layers = Math.max(...nodes.map((n) => n.depth))
  const height = layers * ROW

  return (
    <svg
      className="map"
      viewBox={`${minX} 0 ${width} ${height}`}
      role="img"
      aria-label={`Map of your dig: ${nodes
        .filter((n) => n.status === 'dug')
        .map((n) => n.topic)
        .join(', then ')}`}
    >
      {Array.from({ length: layers }, (_, i) => (
        <rect key={i} x={minX} y={i * ROW} width={width} height={ROW} fill={stratum(i + 1).color} />
      ))}

      {edges.map(({ from, to }) => {
        const dug = to.status === 'dug'
        return dug ? (
          <g key={to.id}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="map__tunnel-edge" />
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="map__tunnel" />
          </g>
        ) : (
          <line
            key={to.id}
            x1={from.x}
            y1={from.y}
            x2={from.x + (to.x - from.x) * 0.8}
            y2={from.y + (to.y - from.y) * 0.8}
            className="map__stub"
          />
        )
      })}

      {nodes.map((n) => {
        const dug = n.status === 'dug'
        return (
          <g key={n.id} className={dug ? 'map__node' : 'map__node map__node--skipped'}>
            <title>{`${n.topic}${dug ? '' : ' (skipped)'}${n.cave_ins ? `, ${n.cave_ins} cave-in${n.cave_ins > 1 ? 's' : ''}` : ''}`}</title>
            <rect
              x={n.x - (dug ? 14 : 8)}
              y={n.y - (dug ? 14 : 8)}
              width={dug ? 28 : 16}
              height={dug ? 28 : 16}
              className="map__chamber"
            />
            {dug && (
              <text x={n.x} y={n.y + 5} className="map__depth">
                {n.depth}
              </text>
            )}
            {Array.from({ length: Math.min(n.cave_ins, 3) }, (_, i) => (
              <rect key={i} x={n.x + 18 + i * 9} y={n.y - 4} width={7} height={7} className="map__rock" />
            ))}
            <text x={n.x} y={n.y + (dug ? 32 : 24)} className="map__label">
              {short(n.topic)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
