import BreakThrough from './components/BreakThrough'
import EndScreen from './components/EndScreen'
import QuestionView from './components/QuestionView'
import StartScreen from './components/StartScreen'
import { useRun } from './useRun'

// Minimal, unstyled test page that proves the frontend <-> backend loop works.
export default function App() {
  const run = useRun()
  const loading = run.phase === 'loading'
  const inRun = run.runId && run.phase !== 'start' && run.phase !== 'surfaced'

  return (
    <div>
      <h1>Rabbit Hole (test page)</h1>
      {run.runId && run.phase !== 'surfaced' && (
        <p>
          Topic: {run.topic} | Depth: {run.depth}{' '}
          <button onClick={run.surface} disabled={loading}>
            Surface
          </button>
        </p>
      )}

      {loading && <p>Loading...</p>}
      {run.error && <p style={{ color: 'red' }}>Error: {run.error}</p>}

      {run.phase === 'start' && <StartScreen onStart={run.startRun} disabled={loading} />}

      {/* While loading, keep showing whatever was on screen before the request. */}
      {inRun && run.turn && (run.phase === 'question' || run.phase === 'caved_in' || loading) && !run.artifact && (
        <QuestionView
          turn={run.turn}
          caveIn={run.wrongCount > 0}
          wrongCount={run.wrongCount}
          onAnswer={run.answer}
          disabled={loading}
        />
      )}
      {inRun && run.artifact && (run.phase === 'broke_through' || loading) && (
        <BreakThrough
          artifact={run.artifact}
          tunnels={run.tunnels}
          onChoose={run.chooseTunnel}
          disabled={loading}
        />
      )}

      {run.phase === 'surfaced' && run.summary && (
        <EndScreen summary={run.summary} onReset={run.reset} />
      )}
    </div>
  )
}
