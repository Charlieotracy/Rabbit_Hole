import Scenery from './Scenery'
import Stratum from './Stratum'

// The whole game world as one tall column behind the UI: sky (with scenery
// and whatever `children` live on the surface), the grass line, then one
// screen-tall stratum per layer. Moving the camera is one CSS transform.
export default function World({ camera, strata, viewport, children }) {
  return (
    <div className="world">
      <div className="world__column" style={{ transform: `translate3d(0, ${-camera}px, 0)` }}>
        <div className="world__sky" style={{ height: viewport.horizon }}>
          <Scenery />
          {children}
        </div>
        <div className="world__ground" />
        {Array.from({ length: strata }, (_, i) => (
          <Stratum key={i} depth={i + 1} height={viewport.vh} />
        ))}
      </div>
    </div>
  )
}
