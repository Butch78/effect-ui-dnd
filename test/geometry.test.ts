import { describe, expect, it } from 'vitest'
import { clip, movedPast, scrollSpeed, targetAt, type ZoneBox } from '../src/geometry.ts'

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

describe('targetAt with closest', () => {
  const rows = [box('a', 0, 0, 100, 30, 'vertical'), box('b', 0, 40, 100, 30, 'vertical')]

  it('takes the nearest zone when the point is in a gap between zones', () => {
    expect(targetAt({ x: 50, y: 34 }, rows, 'closest')).toEqual({ zone: 'a', placement: 'after' })
    expect(targetAt({ x: 50, y: 37 }, rows, 'closest')).toEqual({ zone: 'b', placement: 'before' })
  })

  it('takes the nearest zone when the point is past the last one', () => {
    expect(targetAt({ x: 50, y: 500 }, rows, 'closest')).toEqual({ zone: 'b', placement: 'after' })
  })

  it('still prefers the zone under the point', () => {
    expect(targetAt({ x: 50, y: 45 }, rows, 'closest')).toEqual({ zone: 'b', placement: 'before' })
  })

  it('finds nothing when there are no zones', () => {
    expect(targetAt({ x: 50, y: 45 }, [], 'closest')).toBeNull()
  })
})

describe('scrollSpeed', () => {
  const pane = { left: 0, top: 100, width: 200, height: 300 }

  it('does not scroll away from the edges', () => {
    expect(scrollSpeed({ x: 100, y: 250 }, pane, 40, 20)).toEqual({ x: 0, y: 0 })
  })

  it('scrolls down near the bottom edge, faster the closer the pointer is', () => {
    const near = scrollSpeed({ x: 100, y: 380 }, pane, 40, 20)
    const nearer = scrollSpeed({ x: 100, y: 395 }, pane, 40, 20)

    expect(near.y).toBeGreaterThan(0)
    expect(nearer.y).toBeGreaterThan(near.y)
    expect(near.x).toBe(0)
  })

  it('scrolls up near the top edge, and at full speed past it', () => {
    expect(scrollSpeed({ x: 100, y: 110 }, pane, 40, 20).y).toBeLessThan(0)
    expect(scrollSpeed({ x: 100, y: 70 }, pane, 40, 20).y).toBe(-20)
  })

  it('scrolls sideways near the left and right edges', () => {
    expect(scrollSpeed({ x: 5, y: 250 }, pane, 40, 20).x).toBeLessThan(0)
    expect(scrollSpeed({ x: 195, y: 250 }, pane, 40, 20).x).toBeGreaterThan(0)
  })

  it('does not scroll a pane the pointer has left', () => {
    expect(scrollSpeed({ x: 500, y: 395 }, pane, 40, 20)).toEqual({ x: 0, y: 0 })
  })
})

describe('clip', () => {
  it('keeps the overlap of two rects', () => {
    expect(clip({ left: 0, top: 80, width: 100, height: 40 }, { left: 0, top: 0, width: 200, height: 100 })).toEqual({
      left: 0,
      top: 80,
      width: 100,
      height: 20,
    })
  })

  it('is null when they do not overlap', () => {
    expect(clip({ left: 0, top: 120, width: 100, height: 40 }, { left: 0, top: 0, width: 200, height: 100 })).toBeNull()
  })
})

describe('targetAt with a clipped zone', () => {
  it('only takes the pointer over the visible part, but splits before and after on the whole zone', () => {
    const row: ZoneBox = { ...box('c', 0, 80, 100, 40, 'vertical'), visible: { left: 0, top: 80, width: 100, height: 20 } }

    expect(targetAt({ x: 10, y: 110 }, [row])).toBeNull()
    expect(targetAt({ x: 10, y: 95 }, [row])).toEqual({ zone: 'c', placement: 'before' })
  })
})

describe('targetAt in a column of cards', () => {
  // A column from 0 to 300 holding cards at 10-50 and 60-100; the rest of
  // the column is empty.
  const column: ZoneBox = box('todo', 0, 0, 200, 300)
  const card = (id: string, top: number): ZoneBox => ({ ...box(id, 10, top, 180, 40, 'vertical'), parent: 'todo' })
  const zones = [column, card('one', 10), card('two', 60)]

  it('sends a drop in the gap between two cards to the nearest card', () => {
    expect(targetAt({ x: 100, y: 54 }, zones)).toEqual({ zone: 'one', placement: 'after' })
    expect(targetAt({ x: 100, y: 57 }, zones)).toEqual({ zone: 'two', placement: 'before' })
  })

  it('sends a drop below the last card to after it', () => {
    expect(targetAt({ x: 100, y: 250 }, zones)).toEqual({ zone: 'two', placement: 'after' })
  })

  it('drops inside a column with no cards', () => {
    expect(targetAt({ x: 100, y: 250 }, [column])).toEqual({ zone: 'todo', placement: 'inside' })
  })

  it('ignores the cards of another column', () => {
    const other: ZoneBox = { ...box('far', 500, 10, 180, 40, 'vertical'), parent: 'done' }

    expect(targetAt({ x: 100, y: 250 }, [column, other])).toEqual({ zone: 'todo', placement: 'inside' })
  })
})
