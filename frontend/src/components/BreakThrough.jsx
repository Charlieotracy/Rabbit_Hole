export default function BreakThrough({ artifact, tunnels, onChoose, disabled }) {
  return (
    <div>
      <h3>Break-through!</h3>
      <p>
        Artifact: <b>{artifact.name}</b> (depth {artifact.depth})
      </p>
      <p>Pick a tunnel:</p>
      {tunnels.map((tunnel, i) => (
        <button key={i} onClick={() => onChoose(i)} disabled={disabled}>
          {tunnel}
        </button>
      ))}
    </div>
  )
}
