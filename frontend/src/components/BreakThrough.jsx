import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'

// Milestone 7 adds the dig animation, artifact icons and tunnel arches.
export default function BreakThrough({ artifact, tunnels, onChoose, disabled }) {
  return (
    <div className="stack">
      <Bubble variant="artifact" label="You broke through! You unearthed:">
        <p className="artifact-name">{artifact.name}</p>
        <p className="dim">Found at layer {artifact.depth}</p>
      </Bubble>
      <Bubble label="Three tunnels from here. Which one?">
        <div className="options options--single">
          {tunnels.map((tunnel, i) => (
            <PixelButton key={i} variant="reply" onClick={() => onChoose(i)} disabled={disabled}>
              <span className="pbtn__key">{i + 1}</span>
              {tunnel}
            </PixelButton>
          ))}
        </div>
      </Bubble>
    </div>
  )
}
