import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTree } from './buildTree.js'

test('empty list gives empty tree', () => {
  assert.deepEqual(buildTree([]), [])
})

test('nests children under parents, preserving order', () => {
  const tree = buildTree([
    { id: 'n1', parent_id: null },
    { id: 'n2', parent_id: 'n1' },
    { id: 'n3', parent_id: 'n1' },
    { id: 'n4', parent_id: 'n2' },
  ])
  assert.equal(tree.length, 1)
  assert.deepEqual(tree[0].children.map((c) => c.id), ['n2', 'n3'])
  assert.deepEqual(tree[0].children[0].children.map((c) => c.id), ['n4'])
})

test('orphans become roots and input is not mutated', () => {
  const input = [{ id: 'a', parent_id: 'missing' }]
  const tree = buildTree(input)
  assert.equal(tree[0].id, 'a')
  assert.equal(input[0].children, undefined)
})
