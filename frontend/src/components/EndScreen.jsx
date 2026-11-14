import { buildTree } from '../buildTree'

function TreeNode({ node }) {
  const tags = []
  if (node.status === 'skipped') tags.push('skipped')
  if (node.cave_ins > 0) tags.push(`${node.cave_ins} cave-in${node.cave_ins > 1 ? 's' : ''}`)
  return (
    <li>
      {node.topic} (depth {node.depth}){tags.length > 0 && ` [${tags.join(', ')}]`}
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function EndScreen({ summary, onReset }) {
  const tree = buildTree(summary.map)
  return (
    <div>
      <h2>Surfaced: {summary.topic}</h2>
      <p>Depth reached: {summary.depth}</p>
      <p>Layers cleared: {summary.layers_cleared}</p>
      <p>First-try count: {summary.first_try_count}</p>
      <h3>Artifacts</h3>
      <ul>
        {summary.artifacts.map((a, i) => (
          <li key={i}>
            {a.name} (depth {a.depth})
          </li>
        ))}
      </ul>
      <h3>Map</h3>
      <ul>
        {tree.map((root) => (
          <TreeNode key={root.id} node={root} />
        ))}
      </ul>
      <button onClick={onReset}>New run</button>
    </div>
  )
}
