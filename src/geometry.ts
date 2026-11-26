// Pure geometry: where a pointer is, which zone it is over, and where in that
// zone a drop would land. The DOM code measures; these functions decide.
import * as Schema from 'effect/Schema'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * The axis a sortable zone's items are laid out along. A zone with an axis is
 * one item of a sortable list, and a drop lands before or after it. A zone
 * without one takes drops inside it.
 */
export const Axis = Schema.Literals(['vertical', 'horizontal'])
export type Axis = typeof Axis.Type

export const Placement = Schema.Literals(['before', 'after', 'inside'])
export type Placement = typeof Placement.Type

/** Where a drop would land: a zone, and before, after or inside it. */
export const Target = Schema.Struct({ zone: Schema.String, placement: Placement })
export interface Target extends Schema.Schema.Type<typeof Target> {}

/** A zone as measured on screen. */
export interface ZoneBox {
  readonly id: string
  readonly rect: Rect
  readonly axis: Axis | null
  /** The part not clipped by a scrolling pane around it. Defaults to `rect`. */
  readonly visible?: Rect
  /** The id of the zone around this one, such as the column around a card. */
  readonly parent?: string | null
}

/** The part of `rect` inside `by`, or null when they do not overlap. */
export const clip = (rect: Rect, by: Rect): Rect | null => {
  const left = Math.max(rect.left, by.left)
  const top = Math.max(rect.top, by.top)
  const right = Math.min(rect.left + rect.width, by.left + by.width)
  const bottom = Math.min(rect.top + rect.height, by.top + by.height)

  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null
}

const visibleOf = (zone: ZoneBox): Rect => zone.visible ?? zone.rect

const contains = (rect: Rect, point: Point): boolean =>
  point.x >= rect.left && point.x < rect.left + rect.width && point.y >= rect.top && point.y < rect.top + rect.height

const area = (rect: Rect): number => rect.width * rect.height

const placementIn = (zone: ZoneBox, point: Point): Placement => {
  if (zone.axis === 'vertical') return point.y < zone.rect.top + zone.rect.height / 2 ? 'before' : 'after'
  if (zone.axis === 'horizontal') return point.x < zone.rect.left + zone.rect.width / 2 ? 'before' : 'after'

  return 'inside'
}

/**
 * How a drag finds its target. `pointer`: the zone under the pointer, or none.
 * `closest`: the zone under the pointer, else the zone whose centre is
 * nearest, so the gaps between the rows of a list still take a drop.
 */
export const Collision = Schema.Literals(['pointer', 'closest'])
export type Collision = typeof Collision.Type

const distanceToCentre = (rect: Rect, point: Point): number =>
  Math.hypot(rect.left + rect.width / 2 - point.x, rect.top + rect.height / 2 - point.y)

/**
 * The target for `point`. Where zones nest, the smallest one that holds the
 * point wins, so a card list inside a board column takes the drop before the
 * column does.
 */
export const targetAt = (point: Point, zones: ReadonlyArray<ZoneBox>, collision: Collision = 'pointer'): Target | null => {
  let best: ZoneBox | null = null

  for (const zone of zones) {
    if (!contains(visibleOf(zone), point)) continue
    if (best === null || area(zone.rect) < area(best.rect)) best = zone
  }

  if (best === null && collision === 'closest') {
    for (const zone of zones) {
      if (best === null || distanceToCentre(visibleOf(zone), point) < distanceToCentre(visibleOf(best), point)) {
        best = zone
      }
    }
  }

  if (best === null) return null

  // A plain zone that holds sortable zones, such as a column of cards, sends
  // the drop before or after its nearest card, so the gaps between cards
  // still place the item. An empty one takes it inside.
  if (best.axis === null) {
    const holder: ZoneBox = best
    let nearest: ZoneBox | null = null

    for (const zone of zones) {
      if (zone.parent !== holder.id || zone.axis === null) continue
      if (nearest === null || distanceToCentre(visibleOf(zone), point) < distanceToCentre(visibleOf(nearest), point)) {
        nearest = zone
      }
    }

    if (nearest !== null) best = nearest
  }

  return { zone: best.id, placement: placementIn(best, point) }
}

// Speed along one axis: none outside `edge` of either end, rising to `max`
// at the end and staying at `max` past it.
const speedAlong = (at: number, start: number, length: number, edge: number, max: number): number => {
  const fromStart = at - start
  const fromEnd = start + length - at

  if (fromStart < edge) return -max * (1 - Math.max(0, fromStart) / edge)
  if (fromEnd < edge) return max * (1 - Math.max(0, fromEnd) / edge)

  return 0
}

/**
 * Pixels per frame to scroll `pane` while the pointer is at `point`: towards
 * an edge the pointer is within `edge` pixels of, up to `max`. A pointer up to
 * `edge` pixels outside the pane still scrolls it, at full speed; one further
 * away has left it.
 */
export const scrollSpeed = (point: Point, pane: Rect, edge: number, max: number): Point => {
  const near =
    point.x >= pane.left - edge &&
    point.x <= pane.left + pane.width + edge &&
    point.y >= pane.top - edge &&
    point.y <= pane.top + pane.height + edge

  if (!near) return { x: 0, y: 0 }

  return {
    x: speedAlong(point.x, pane.left, pane.width, edge, max),
    y: speedAlong(point.y, pane.top, pane.height, edge, max),
  }
}

/** Whether the pointer has moved far enough from where it was pressed to start a drag. */
export const movedPast = (origin: Point, point: Point, distance: number): boolean =>
  Math.hypot(point.x - origin.x, point.y - origin.y) >= distance
