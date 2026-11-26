import { describe, expect, it } from 'vitest'
import { movedPast, targetAt, type ZoneBox } from '../src/geometry.ts'

const box = (id: string, left: number, top: number, width: number, height: number, axis: ZoneBox['axis'] = null): ZoneBox => ({
  id,
  rect: { left, top, width, height },
  axis,
})

describe('targetAt', () => {
  it('finds no target outside every zone', () => {
    expect(targetAt({ x: 500, y: 500 }, [box('todo', 0, 0, 100, 100)])).toBeNull()
  })

  it('drops inside a plain zone', () => {
    expect(targetAt({ x: 50, y: 50 }, [box('todo', 0, 0, 100, 100)])).toEqual({ zone: 'todo', placement: 'inside' })
  })

  it('picks the innermost zone when zones nest', () => {
    const zones = [box('board', 0, 0, 400, 400), box('column', 10, 10, 100, 300)]

    expect(targetAt({ x: 20, y: 20 }, zones)).toEqual({ zone: 'column', placement: 'inside' })
  })

  it('splits a vertical sortable row at its middle', () => {
    const row = [box('a', 0, 0, 100, 40, 'vertical')]

    expect(targetAt({ x: 10, y: 19 }, row)).toEqual({ zone: 'a', placement: 'before' })
    expect(targetAt({ x: 10, y: 21 }, row)).toEqual({ zone: 'a', placement: 'after' })
  })

  it('splits a horizontal sortable item at its middle', () => {
    const tab = [box('a', 0, 0, 100, 40, 'horizontal')]

    expect(targetAt({ x: 49, y: 10 }, tab)).toEqual({ zone: 'a', placement: 'before' })
    expect(targetAt({ x: 51, y: 10 }, tab)).toEqual({ zone: 'a', placement: 'after' })
  })

  it('counts the right and bottom edges as outside', () => {
    expect(targetAt({ x: 100, y: 50 }, [box('todo', 0, 0, 100, 100)])).toBeNull()
  })
})

describe('movedPast', () => {
  it('starts a drag once the pointer moves the activation distance', () => {
    expect(movedPast({ x: 0, y: 0 }, { x: 5, y: 5 }, 8)).toBe(false)
    expect(movedPast({ x: 0, y: 0 }, { x: 6, y: 6 }, 8)).toBe(true)
  })
})
