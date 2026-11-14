import { pixelRects } from './pixel'

// Renders one text-grid sprite as an SVG. `scale` is screen pixels per art pixel.
export default function PixelSprite({ rows, palette, scale = 4, className = '', ...rest }) {
  const width = rows[0].length
  const height = rows.length
  return (
    <svg
      className={`sprite ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width * scale}
      height={height * scale}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {pixelRects(rows, palette)}
    </svg>
  )
}
