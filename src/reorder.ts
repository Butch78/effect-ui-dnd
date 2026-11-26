import type { Placement } from './geometry.ts'

/** A finished drop: the item, the zone it landed on, and where in that zone. */
export interface Drop {
  readonly item: string
  readonly zone: string
  readonly placement: Placement
}

/**
 * The ids of a sortable list after `drop`, where the list's zones carry the
 * same ids as its items. Returns `ids` itself when nothing moves: an item or
 * zone the list does not hold, an inside drop, or a drop next to the item's
 * own place.
 */
export const reorder = <Id extends string>(ids: ReadonlyArray<Id>, drop: Drop): ReadonlyArray<Id> => {
  const from = ids.findIndex((id) => id === drop.item)
  const moved = ids[from]

  if (moved === undefined || !ids.some((id) => id === drop.zone) || drop.placement === 'inside') return ids

  const rest = ids.filter((_, index) => index !== from)
  const at = rest.findIndex((id) => id === drop.zone)
  const insertAt = at < 0 ? from : drop.placement === 'before' ? at : at + 1

  if (insertAt === from) return ids

  return [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)]
}
