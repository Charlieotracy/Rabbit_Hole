import { cameraY } from './lib/camera'
import { useViewport } from './lib/useViewport'
import World from './scene/World'
import EndScreen from './screens/EndScreen'
import RunScreen from './screens/RunScreen'
import StartScreen from './screens/StartScreen'
import { useGame } from './useGame'

// The World (sky + strata) sits behind everything and its camera follows the
// game. The start screen lives in the sky, so it scrolls away as you descend;
// the run and end screens are overlays in front.
export default function App() {
  const game = useGame()
  const viewport = useViewport()
  const strata = Math.max(2, game.path.length + 1)

  return (
    <>
      <World camera={cameraY(game, viewport)} strata={strata} viewport={viewport}>
        {game.screen !== 'end' && <StartScreen key={game.runCount} game={game} />}
      </World>
      {game.screen === 'run' && <RunScreen game={game} />}
      {game.screen === 'end' && game.summary && <EndScreen game={game} />}
    </>
  )
}
