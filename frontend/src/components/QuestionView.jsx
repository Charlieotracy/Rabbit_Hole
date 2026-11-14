import Panel from '../ui/Panel'
import PixelButton from '../ui/PixelButton'

// Shows a turn: used for a normal question and for a cave-in.
export default function QuestionView({ turn, depth, caveIn, wrongCount, onAnswer, disabled }) {
  return (
    <Panel
      tone={caveIn ? 'danger' : 'accent'}
      tag={caveIn ? `${wrongCount} cave-in${wrongCount > 1 ? 's' : ''}` : undefined}
      label={caveIn ? 'Cave-in · try another angle' : `Layer ${depth}`}
      aria-live="polite"
    >
      {caveIn && turn.style && <p className="style-chip">Explained as: {turn.style}</p>}
      <p className="layer-text">{turn.layer}</p>
      <hr className="divider" />
      <h2 className="question">{turn.question}</h2>
      <div className="options">
        {turn.options.map((option, i) => (
          <PixelButton key={i} variant="option" onClick={() => onAnswer(i)} disabled={disabled}>
            <span className="pbtn__key">{i + 1}</span>
            {option}
          </PixelButton>
        ))}
      </div>
    </Panel>
  )
}
