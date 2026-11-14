// Turns the backend's flat map list into a nested tree.
//
// Input:  [{ id, parent_id, topic, depth, status, cave_ins }, ...]
// Output: array of root nodes, each { ...node, children: [...] }
//
// Example:
//   buildTree([
//     { id: 'n1', parent_id: null, topic: 'Black holes' },
//     { id: 'n2', parent_id: 'n1', topic: 'Event horizon' },
//   ])
//   // -> [{ id: 'n1', ..., children: [{ id: 'n2', ..., children: [] }] }]
//
// Nodes whose parent_id is missing from the list are treated as roots.
// Tests: `npm test` (see buildTree.test.js).
export function buildTree(flatNodes) {
  const byId = new Map()
  for (const node of flatNodes) byId.set(node.id, { ...node, children: [] })

  const roots = []
  for (const node of flatNodes) {
    const copy = byId.get(node.id)
    const parent = node.parent_id == null ? undefined : byId.get(node.parent_id)
    if (parent) parent.children.push(copy)
    else roots.push(copy)
  }
  return roots
}
