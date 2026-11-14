import Panel from '../ui/Panel'
import PixelButton from '../ui/PixelButton'

export default function BreakThrough({ artifact, tunnels, onChoose, disabled }) {
  return (
    <div className="stack">
      <Panel tone="gold" tag="Unearthed" label="Break-through!">
        <p className="artifact-name">{artifact.name}</p>
        <p className="dim">Found at layer {artifact.depth}</p>
      </Panel>
      <Panel label="Pick a tunnel">
        <div className="options">
          {tunnels.map((tunnel, i) => (
            <PixelButton key={i} variant="option" onClick={() => onChoose(i)} disabled={disabled}>
              <span className="pbtn__key">{i + 1}</span>
              {tunnel}
            </PixelButton>
          ))}
        </div>
      </Panel>
    </div>
  )
}
