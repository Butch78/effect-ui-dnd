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
}

const contains = (rect: Rect, point: Point): boolean =>
  point.x >= rect.left && point.x < rect.left + rect.width && point.y >= rect.top && point.y < rect.top + rect.height

const area = (rect: Rect): number => rect.width * rect.height

const placementIn = (zone: ZoneBox, point: Point): Placement => {
  if (zone.axis === 'vertical') return point.y < zone.rect.top + zone.rect.height / 2 ? 'before' : 'after'
  if (zone.axis === 'horizontal') return point.x < zone.rect.left + zone.rect.width / 2 ? 'before' : 'after'

  return 'inside'
}

/**
 * The target under `point`. Where zones nest, the smallest one that holds the
 * point wins, so a card list inside a board column takes the drop before the
 * column does.
 */
export const targetAt = (point: Point, zones: ReadonlyArray<ZoneBox>): Target | null => {
  let best: ZoneBox | null = null

  for (const zone of zones) {
    if (!contains(zone.rect, point)) continue
    if (best === null || area(zone.rect) < area(best.rect)) best = zone
  }

  return best === null ? null : { zone: best.id, placement: placementIn(best, point) }
}

/** Whether the pointer has moved far enough from where it was pressed to start a drag. */
export const movedPast = (origin: Point, point: Point, distance: number): boolean =>
  Math.hypot(point.x - origin.x, point.y - origin.y) >= distance
