import BreakThrough from './components/BreakThrough'
import EndScreen from './components/EndScreen'
import QuestionView from './components/QuestionView'
import StartScreen from './components/StartScreen'
import { useRun } from './useRun'
import Bubble from './ui/Bubble'
import PixelButton from './ui/PixelButton'

export default function App() {
  const run = useRun()
  const loading = run.phase === 'loading'
  const inRun = run.runId && run.phase !== 'start' && run.phase !== 'surfaced'
  const onStartScreen = run.phase === 'start' || (loading && !run.runId)
  const errorBubble = run.error && (
    <Bubble variant="cave" className="error" role="alert">
      <p>{run.error}</p>
    </Bubble>
  )

  return (
    <main className={`app ${onStartScreen ? 'app--start' : ''}`}>
      {run.runId && run.phase !== 'surfaced' && (
        <Bubble variant="plain" as="header" className="hud">
          <div className="hud__row">
            <span className="hud__depth">
              ⛏ {run.depth}
              <small>{run.depth === 1 ? 'layer' : 'layers'}</small>
            </span>
            <span className="hud__topic" title={run.topic}>
              {run.topic}
            </span>
            <PixelButton size="sm" variant="ghost" onClick={run.surface} disabled={loading}>
              Surface ↑
            </PixelButton>
          </div>
        </Bubble>
      )}

      {!onStartScreen && errorBubble}

      {onStartScreen && <StartScreen onStart={run.startRun} disabled={loading} />}
      {onStartScreen && errorBubble}

      {loading && (
        <p className="status" role="status">
          Digging<span className="status__dots" aria-hidden="true" />
        </p>
      )}

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
