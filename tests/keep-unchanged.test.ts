import assert from 'node:assert/strict'
import test from 'node:test'

import { keepUnchanged, sameData } from '../src/common/keepUnchanged'

test('R-501: equal data is the same, any difference is not', () => {
  assert.ok(sameData({ a: [1, { b: 'x' }], c: null }, { c: null, a: [1, { b: 'x' }] }))
  assert.ok(!sameData({ a: [1, 2] }, { a: [1, 2, 3] }))
  assert.ok(!sameData({ a: 1 }, { a: 1, b: undefined }))
  assert.ok(!sameData({ a: { b: 1 } }, { a: { b: 2 } }))
  assert.ok(!sameData([1], { 0: 1 }))
})

test('R-501: unchanged items keep their objects, the list too when nothing changed', () => {
  const id = (item: { id: string }) => item.id
  const before = [
    { id: 'a', v: 1 },
    { id: 'b', v: 2 },
  ]
  const same = keepUnchanged(before, structuredClone(before), id)!
  assert.equal(same, before)
  const changed = keepUnchanged(
    before,
    [
      { id: 'a', v: 1 },
      { id: 'b', v: 3 },
    ],
    id
  )!
  assert.notEqual(changed, before)
  assert.equal(changed[0], before[0])
  assert.notEqual(changed[1], before[1])
  assert.equal(changed[1].v, 3)
  // A new order, an added or a removed item gives a new list that still reuses the unchanged objects.
  const reordered = keepUnchanged(before, structuredClone([before[1], before[0]]), id)!
  assert.notEqual(reordered, before)
  assert.equal(reordered[0], before[1])
  const added = keepUnchanged(before, [...structuredClone(before), { id: 'c', v: 4 }], id)!
  assert.equal(added.length, 3)
  assert.equal(added[1], before[1])
  assert.equal(keepUnchanged(undefined, before, id), before)
  assert.equal(keepUnchanged(before, undefined, id), undefined)
})
