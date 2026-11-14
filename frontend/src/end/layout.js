import { buildTree } from '../buildTree.js'

export const ROW = 96 // vertical distance between layers
export const SPREAD = 150 // horizontal distance between sibling tunnels
// Lays the tree out top-down: each node's children spread evenly under it.
export function layoutTree(map) {
  const nodes = []
  const edges = []
  const place = (node, x, y, parent) => {
    const placed = { ...node, x, y }
    nodes.push(placed)
    if (parent) edges.push({ from: parent, to: placed })
    const kids = node.children
    kids.forEach((child, i) => place(child, x + (i - (kids.length - 1) / 2) * SPREAD, y + ROW, placed))
  }
  buildTree(map).forEach((root, i) => place(root, i * SPREAD * 3, ROW / 2, null))
  return { nodes, edges }
}

