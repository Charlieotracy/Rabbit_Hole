import { createElement } from 'react'

// Pixel art is written as text grids: one string per row, one character per
// pixel. A palette maps characters to colours ('.' or any unmapped char is
// transparent). Runs of the same colour in a row merge into one <rect>.
//
//   pixelRects(['.KK.', 'KWWK'], { K: 'var(--ink)', W: '#fff' })

export function pixelRects(rows, palette, keyPrefix = '') {
  const rects = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      const color = palette[ch]
      if (color) {
        rects.push(
          createElement('rect', {
            key: `${keyPrefix}${x}-${y}`,
            x,
            y,
            width: end - x,
            height: 1,
            style: { fill: color },
          }),
        )
      }
      x = end
    }
  })
  return rects
}

// Builds a sparse overlay grid: every row is transparent except those given.
export function overlay(width, height, rowsByIndex) {
  return Array.from({ length: height }, (_, y) => rowsByIndex[y] ?? '.'.repeat(width))
}

// Swaps rows and columns (used to turn a downward speech-bubble tail sideways).
export function transpose(rows) {
  const width = rows[0].length
  return Array.from({ length: width }, (_, x) => rows.map((row) => row[x]).join(''))
}

export function mirror(rows) {
  return rows.map((row) => [...row].reverse().join(''))
}
