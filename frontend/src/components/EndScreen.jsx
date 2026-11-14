import { buildTree } from '../buildTree'
import Bubble from '../ui/Bubble'
import PixelButton from '../ui/PixelButton'
import Title from '../ui/Title'

function TreeNode({ node }) {
  const tags = []
  if (node.status === 'skipped') tags.push('skipped')
  if (node.cave_ins > 0) tags.push(`${node.cave_ins} cave-in${node.cave_ins > 1 ? 's' : ''}`)
  return (
    <li className={node.status === 'skipped' ? 'tree__node tree__node--skipped' : 'tree__node'}>
      {node.topic} <span className="dim">(layer {node.depth})</span>
      {tags.length > 0 && <span className="tree__tags"> [{tags.join(', ')}]</span>}
      {node.children.length > 0 && (
        <ul className="tree">
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
    <>
      <Title tagline="Surfaced" subline={summary.topic} />
      <Bubble label="Run complete">
        <dl className="stats">
          <div>
            <dt>Depth</dt>
            <dd>{summary.depth}</dd>
          </div>
          <div>
            <dt>Layers cleared</dt>
            <dd>{summary.layers_cleared}</dd>
          </div>
          <div>
            <dt>First try</dt>
            <dd>
              {summary.first_try_count}/{summary.layers_cleared}
            </dd>
          </div>
        </dl>
      </Bubble>

      <Bubble variant="artifact" label="Artifacts">
        {summary.artifacts.length === 0 ? (
          <p className="dim">None yet. Clear a layer to unearth one.</p>
        ) : (
          <ul className="artifact-list">
            {summary.artifacts.map((a, i) => (
              <li key={i}>
                {a.name} <span className="dim">(layer {a.depth})</span>
              </li>
            ))}
          </ul>
        )}
      </Bubble>

      <Bubble label="Your tunnel">
        <ul className="tree tree--root">
          {tree.map((root) => (
            <TreeNode key={root.id} node={root} />
          ))}
        </ul>
      </Bubble>

      <PixelButton variant="primary" size="lg" onClick={onReset}>
        Dig again ⛏
      </PixelButton>
    </>
  )
}
