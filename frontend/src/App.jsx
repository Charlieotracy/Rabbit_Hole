import BreakThrough from './components/BreakThrough'
import EndScreen from './components/EndScreen'
import QuestionView from './components/QuestionView'
import StartScreen from './components/StartScreen'
import { useRun } from './useRun'
import Panel from './ui/Panel'
import PixelButton from './ui/PixelButton'
import Title from './ui/Title'

export default function App() {
  const run = useRun()
  const loading = run.phase === 'loading'
  const inRun = run.runId && run.phase !== 'start' && run.phase !== 'surfaced'

  return (
    <main className="app">
      {run.runId && run.phase !== 'surfaced' && (
        <Panel tone="plain" as="header" className="hud">
          <div className="hud__row">
            <span className="hud__depth">
              −{run.depth}
              <small>{run.depth === 1 ? 'layer' : 'layers'}</small>
            </span>
            <span className="hud__topic" title={run.topic}>
              {run.topic}
            </span>
            <PixelButton size="sm" variant="ghost" onClick={run.surface} disabled={loading}>
              Surface ↑
            </PixelButton>
          </div>
        </Panel>
      )}

      {run.phase === 'start' && (
        <Title
          tagline="Dig into anything"
          subline="any topic · one layer at a time · earn your depth"
        />
      )}

      {loading && (
        <p className="status" role="status">
          Digging<span className="status__dots" aria-hidden="true" />
        </p>
      )}
      {run.error && (
        <Panel tone="danger" className="error" role="alert">
          <p>{run.error}</p>
        </Panel>
      )}

      {run.phase === 'start' && <StartScreen onStart={run.startRun} disabled={loading} />}

      {/* While loading, keep showing whatever was on screen before the request. */}
      {inRun && run.turn && (run.phase === 'question' || run.phase === 'caved_in' || loading) && !run.artifact && (
        <QuestionView
          turn={run.turn}
          depth={run.depth}
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
    </main>
  )
}
