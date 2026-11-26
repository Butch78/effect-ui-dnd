import { describe, expect, it } from 'vitest'
import { reorder } from '../src/reorder.ts'

const ids = ['a', 'b', 'c', 'd']

describe('reorder', () => {
  it('moves an item down, after its target', () => {
    expect(reorder(ids, { item: 'a', zone: 'c', placement: 'after' })).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item up, before its target', () => {
    expect(reorder(ids, { item: 'd', zone: 'b', placement: 'before' })).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves an item to the end', () => {
    expect(reorder(ids, { item: 'b', zone: 'd', placement: 'after' })).toEqual(['a', 'c', 'd', 'b'])
  })

  it('leaves the list alone when an item lands next to itself', () => {
    expect(reorder(ids, { item: 'b', zone: 'b', placement: 'before' })).toBe(ids)
    expect(reorder(ids, { item: 'b', zone: 'a', placement: 'after' })).toBe(ids)
  })

  it('leaves the list alone for an item or target it does not hold, or an inside drop', () => {
    expect(reorder(ids, { item: 'x', zone: 'a', placement: 'before' })).toBe(ids)
    expect(reorder(ids, { item: 'a', zone: 'x', placement: 'before' })).toBe(ids)
    expect(reorder(ids, { item: 'a', zone: 'c', placement: 'inside' })).toBe(ids)
  })
})
