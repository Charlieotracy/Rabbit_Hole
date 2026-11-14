// Helpers for generating text-grid sprites from simple shapes (circles,
// rectangles) instead of drawing every row by hand. Output is the same
// rows-of-characters format that pixelRects() renders.

// True when the centre of pixel (x, y) is inside the circle.
export const inCircle = (x, y, cx, cy, r) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r

// fill(x, y) returns a palette character, or null for empty.
// If `outline` is given, empty pixels touching the shape (4-neighbours)
// become that character, which gives a clean 1-pixel pixel-art outline.
export function rasterize(width, height, fill, outline) {
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => fill(x, y)),
  )
  const near = (x, y) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx])

  return grid.map((row, y) =>
    row.map((c, x) => c || (outline && near(x, y) ? outline : '.')).join(''),
  )
}

// Stepped "pixel circle" corners for clip-path. `steps[i]` is how far row i
// (from the top) is inset from the side, in --px units. Returns a CSS polygon.
export function steppedCorners(steps, unit = 'var(--px)') {
  const n = steps.length
  // Top-left corner, walking from the left edge up to the top edge.
  const tl = [[0, n]]
  let x = 0
  for (let i = n - 1; i >= 0; i--) {
    if (steps[i] !== x) {
      tl.push([x, i + 1], [steps[i], i + 1])
      x = steps[i]
    }
  }
  tl.push([x, 0])

  const fx = (k, right) => (right ? (k ? `calc(100% - ${k} * ${unit})` : '100%') : k ? `calc(${k} * ${unit})` : '0')
  const fy = (k, bottom) => (bottom ? (k ? `calc(100% - ${k} * ${unit})` : '100%') : k ? `calc(${k} * ${unit})` : '0')

  const pts = [
    ...tl.map(([px, py]) => `${fx(px, false)} ${fy(py, false)}`),
    ...[...tl].reverse().map(([px, py]) => `${fx(px, true)} ${fy(py, false)}`),
    ...tl.map(([px, py]) => `${fx(px, true)} ${fy(py, true)}`),
    ...[...tl].reverse().map(([px, py]) => `${fx(px, false)} ${fy(py, true)}`),
  ]
  return `polygon(${pts.join(', ')})`
}
