import { Bird, Cloud, Sun, Tree } from './sprites/scenery'

// Decorative surface layer behind the UI: sun, drifting clouds, a flock of
// birds and two trees on the grass line. Milestone 3 moves this into the
// World column so it scrolls away as the camera descends.
export default function Scenery() {
  return (
    <div className="scenery" aria-hidden="true">
      <Sun className="scenery__sun" />

      <Cloud scale={4} className="scenery__cloud scenery__cloud--1" />
      <Cloud scale={3} className="scenery__cloud scenery__cloud--2" />
      <Cloud scale={5} className="scenery__cloud scenery__cloud--3" />

      <div className="scenery__flock">
        <Bird className="scenery__bird" style={{ left: 0, top: 10 }} />
        <Bird className="scenery__bird" style={{ left: 34, top: 0 }} />
        <Bird className="scenery__bird" style={{ left: 62, top: 18 }} />
      </div>

      <Tree className="scenery__tree scenery__tree--left" />
      <Tree mirrored className="scenery__tree scenery__tree--right" />
    </div>
  )
}
