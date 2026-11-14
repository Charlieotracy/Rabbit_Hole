import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'

// Shows a turn: used for a normal question and for a cave-in.
// Milestone 4 turns this into the chat log with the bunny.
export default function QuestionView({ turn, depth, caveIn, wrongCount, onAnswer, disabled }) {
  return (
    <Bubble
      variant={caveIn ? 'cave' : 'bunny'}
      label={
        caveIn
          ? `Cave-in${wrongCount > 1 ? ` ×${wrongCount}` : ''} · let's try another way`
          : `Layer ${depth}`
      }
      aria-live="polite"
    >
      {caveIn && turn.style && <p className="style-chip">Explained as: {turn.style}</p>}
      <p className="layer-text">{turn.layer}</p>
      <hr className="divider" />
      <h2 className="question">{turn.question}</h2>
      <div className="options">
        {turn.options.map((option, i) => (
          <PixelButton key={i} variant="reply" onClick={() => onAnswer(i)} disabled={disabled}>
            <span className="pbtn__key">{i + 1}</span>
            {option}
          </PixelButton>
        ))}
      </div>
    </Bubble>
  )
}
