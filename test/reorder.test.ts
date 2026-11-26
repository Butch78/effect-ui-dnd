import { describe, expect, it } from 'vitest'
import { moveBetween, reorder } from '../src/reorder.ts'

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

describe('moveBetween', () => {
  const board = { todo: ['a', 'b'], doing: ['c'], done: [] as Array<string> }

  it('moves an item onto a card in another list, before or after it', () => {
    expect(moveBetween(board, { item: 'a', zone: 'c', placement: 'before' })).toEqual({
      todo: ['b'],
      doing: ['a', 'c'],
      done: [],
    })
    expect(moveBetween(board, { item: 'a', zone: 'c', placement: 'after' })).toEqual({
      todo: ['b'],
      doing: ['c', 'a'],
      done: [],
    })
  })

  it('moves an item into a list, at its end', () => {
    expect(moveBetween(board, { item: 'b', zone: 'done', placement: 'inside' })).toEqual({
      todo: ['a'],
      doing: ['c'],
      done: ['b'],
    })
    expect(moveBetween(board, { item: 'a', zone: 'doing', placement: 'inside' })).toEqual({
      todo: ['b'],
      doing: ['c', 'a'],
      done: [],
    })
  })

  it('reorders within one list', () => {
    expect(moveBetween(board, { item: 'a', zone: 'b', placement: 'after' })).toEqual({
      todo: ['b', 'a'],
      doing: ['c'],
      done: [],
    })
  })

  it('returns the lists themselves when nothing moves', () => {
    expect(moveBetween(board, { item: 'a', zone: 'a', placement: 'before' })).toBe(board)
    expect(moveBetween(board, { item: 'a', zone: 'b', placement: 'before' })).toBe(board)
    expect(moveBetween(board, { item: 'x', zone: 'done', placement: 'inside' })).toBe(board)
    expect(moveBetween(board, { item: 'a', zone: 'nowhere', placement: 'inside' })).toBe(board)
  })

  it('moves an item dropped inside its own list to the end of it', () => {
    expect(moveBetween(board, { item: 'a', zone: 'todo', placement: 'inside' })).toEqual({
      todo: ['b', 'a'],
      doing: ['c'],
      done: [],
    })
  })
})
