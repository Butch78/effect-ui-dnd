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

/**
 * The lists after `drop`, for items that move between lists, such as the
 * columns of a board. A drop on an item lands before or after it, in that
 * item's list; a drop inside a list lands at its end. Returns `lists` itself
 * when nothing moves: an item or zone no list holds, or a drop next to the
 * item's own place.
 */
export const moveBetween = <Key extends string, Id extends string>(
  lists: Readonly<Record<Key, ReadonlyArray<Id>>>,
  drop: Drop,
): Readonly<Record<Key, ReadonlyArray<Id>>> => {
  const keys = Object.keys(lists).filter((key): key is Key => key in lists)
  const from = keys.find((key) => lists[key].some((id) => id === drop.item))
  const into =
    drop.placement === 'inside'
      ? keys.find((key) => key === drop.zone)
      : keys.find((key) => lists[key].some((id) => id === drop.zone))

  if (from === undefined || into === undefined || drop.item === drop.zone) return lists
  if (from === into && drop.placement !== 'inside') {
    const reordered = reorder(lists[from], drop)

    return reordered === lists[from] ? lists : { ...lists, [from]: reordered }
  }

  const moved = lists[from].find((id) => id === drop.item)

  if (moved === undefined) return lists

  const left = lists[from].filter((id) => id !== drop.item)
  const target = from === into ? left : lists[into]
  const at = target.findIndex((id) => id === drop.zone)
  const insertAt = drop.placement === 'inside' ? target.length : drop.placement === 'before' ? at : at + 1
  const placed = [...target.slice(0, insertAt), moved, ...target.slice(insertAt)]

  return from === into ? { ...lists, [into]: placed } : { ...lists, [from]: left, [into]: placed }
}
