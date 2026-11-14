import ArtifactIcon from '../scene/sprites/icons'

export default function ArtifactShelf({ artifacts }) {
  if (artifacts.length === 0) {
    return <p className="dim">No artifacts this time. Clear a layer to unearth one!</p>
  }
  return (
    <ul className="shelf">
      {artifacts.map((a, i) => (
        <li key={i} className="shelf__item">
          <ArtifactIcon name={a.icon} scale={4} />
          <span className="shelf__name">{a.name}</span>
          <span className="shelf__layer">Layer {a.depth}</span>
        </li>
      ))}
    </ul>
  )
}
