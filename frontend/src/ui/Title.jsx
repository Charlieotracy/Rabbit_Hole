// Dark pixel logo: ink letters with a hard grass-green shadow.
export default function Title({ tagline, subline }) {
  return (
    <header className="title">
      <h1 className="title__logo">Rabbit Hole</h1>
      {tagline && <p className="title__tagline">{tagline}</p>}
      {subline && <p className="title__subline">{subline}</p>}
    </header>
  )
}
