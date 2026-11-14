// Shows a turn: used for a normal question and for a cave-in.
export default function QuestionView({ turn, caveIn, wrongCount, onAnswer, disabled }) {
  return (
    <div>
      {caveIn && <h3>Cave-in! (wrong answers on this layer: {wrongCount})</h3>}
      <p>{turn.layer}</p>
      <h3>{turn.question}</h3>
      <ul>
        {turn.options.map((option, i) => (
          <li key={i}>
            <button onClick={() => onAnswer(i)} disabled={disabled}>
              {option}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
