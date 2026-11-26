/**
 * Headless drag and drop for Effect UI, by pointer, touch and keyboard.
 *
 * A `DragArea` holds draggable items and drop zones. Items and zones carry
 * string ids; the area reports a finished drop as a `Dropped` event with the
 * item, the zone and the placement, and the consumer looks its own data up
 * by id. A zone with an axis is one entry of a sortable list: a drop lands
 * before or after it, and `reorder` turns the drop into the new order.
 *
 * **Anatomy**
 *
 * | Part           | Element                                              |
 * | :------------- | :--------------------------------------------------- |
 * | `root`         | the element that holds every item and zone           |
 * | `item`         | each draggable element, by id                        |
 * | `zone`         | each drop target, by id, with an optional axis       |
 * | `preview`      | the floating copy under the pointer while dragging   |
 * | `announcer`    | a visually hidden live region for screen readers     |
 * | `instructions` | visually hidden keyboard instructions items point to |
 *
 * **Input**
 *
 * - Mouse and pen: a press becomes a drag after the pointer moves `distance`
 *   pixels (8 by default), so a click still clicks.
 * - Touch: with `pressDelay`, a drag starts after the finger holds still that
 *   long, so a swipe still scrolls. Without it, touch drags like a mouse.
 * - Keyboard: Space or Enter on a focused item picks it up, the arrow keys
 *   step through the zones in document order, Space or Enter drops, Escape
 *   puts it back.
 *
 * **Data attributes**
 *
 * - `root`: `data-dragging`, `data-disabled`
 * - `item`: `data-dragging` on the item being dragged
 * - `zone`: `data-over` and `data-placement` while a drag is over it
 */
import * as Html from '@effect/ui/html/Html'
import * as Mount from '@effect/ui/Mount'
import * as UiSchema from '@effect/ui/UiSchema'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { Axis, clip, Collision, movedPast, scrollSpeed, Target, targetAt, type Point, type Rect, type ZoneBox } from './geometry.ts'

// -- schemas -----------------------------------------------------------------

/** What a screen reader hears. `{item}` and `{zone}` take the spoken names. */
export const DragAreaPhrases = Schema.Struct({
  instructions: Schema.String,
  pickedUp: Schema.String,
  over: Schema.String,
  before: Schema.String,
  after: Schema.String,
  notOver: Schema.String,
  dropped: Schema.String,
  putBack: Schema.String,
})
export interface DragAreaPhrases extends Schema.Schema.Type<typeof DragAreaPhrases> {}

export const englishPhrases: DragAreaPhrases = {
  instructions:
    'Press Space or Enter to pick up. Use the arrow keys to move, Space or Enter to drop, Escape to put it back.',
  pickedUp: 'Picked up {item}.',
  over: '{item} is over {zone}.',
  before: '{item} is before {zone}.',
  after: '{item} is after {zone}.',
  notOver: '{item} is not over a drop place.',
  dropped: '{item} was dropped on {zone}.',
  putBack: '{item} was put back.',
}

export const DragAreaProps = Schema.Struct({
  disabled: Schema.optional(Schema.Boolean),
  /** Pixels a mouse or pen moves before a press becomes a drag. Default 8. */
  distance: Schema.optional(Schema.Finite),
  /** Milliseconds a finger holds still before a touch becomes a drag. Default 0. */
  pressDelay: Schema.optional(Schema.Finite),
  /** Spoken names of items and zones, by id. An id without one is read as is. */
  labels: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  phrases: Schema.optional(DragAreaPhrases),
  /** How a drag finds its target: `pointer` (default) or `closest`. */
  collision: Schema.optional(Collision),
  /** What moves with the pointer: a `preview` you draw (default), or the `item` itself. */
  follow: Schema.optional(Schema.Literals(['preview', 'item'])),
  /** Scroll the panes around the area, and the page, near their edges. Default true. */
  autoScroll: Schema.optional(Schema.Boolean),
})
export interface DragAreaProps extends Schema.Schema.Type<typeof DragAreaProps> {}

export const DragAreaEvents = UiSchema.TaggedEnum({
  /** An item was dropped on a zone. */
  Dropped: { item: Schema.String, zone: Schema.String, placement: Target.fields.placement },
  /** A drag ended outside every zone, or was cancelled. */
  PutBack: { item: Schema.String },
})
export type DragAreaEvents = typeof DragAreaEvents.Type

const Via = Schema.Literals(['pointer', 'keyboard'])

const Drag = Schema.Struct({
  item: Schema.String,
  via: Via,
  x: Schema.Finite,
  y: Schema.Finite,
  // Where the pointer holds the item, from its top left, and its size.
  grabX: Schema.Finite,
  grabY: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  // Where the item would be without the drag, for `follow: "item"`.
  left: Schema.Finite,
  top: Schema.Finite,
  over: Schema.NullOr(Target),
})
interface Drag extends Schema.Schema.Type<typeof Drag> {}

const DragAreaModel = Schema.Struct({
  drag: Schema.NullOr(Drag),
  announcement: Schema.String,
})
interface DragAreaModel extends Schema.Schema.Type<typeof DragAreaModel> {}

const DragAreaMessage = UiSchema.TaggedEnum({
  PickedUp: { drag: Drag },
  Moved: {
    x: Schema.Finite,
    y: Schema.Finite,
    left: Schema.Finite,
    top: Schema.Finite,
    over: Schema.NullOr(Target),
  },
  Released: { over: Schema.NullOr(Target) },
  Cancelled: {},
})
type DragAreaMessage = typeof DragAreaMessage.Type

// -- announcements -----------------------------------------------------------

const spoken = (props: DragAreaProps, id: string): string => props.labels?.[id] ?? id

const phrase = (template: string, props: DragAreaProps, item: string, zone?: string): string =>
  template.replaceAll('{item}', spoken(props, item)).replaceAll('{zone}', zone === undefined ? '' : spoken(props, zone))

const phrasesOf = (props: DragAreaProps): DragAreaPhrases => props.phrases ?? englishPhrases

const overPhrase = (props: DragAreaProps, item: string, over: Target | null): string => {
  const phrases = phrasesOf(props)

  if (over === null) return phrase(phrases.notOver, props, item)

  const template = over.placement === 'before' ? phrases.before : over.placement === 'after' ? phrases.after : phrases.over

  return phrase(template, props, item, over.zone)
}

const sameTarget = (a: Target | null, b: Target | null): boolean =>
  a === null || b === null ? a === b : a.zone === b.zone && a.placement === b.placement

// -- the DOM -----------------------------------------------------------------

const ITEM = 'data-dnd-item'
const ZONE = 'data-dnd-zone'
const AXIS = 'data-dnd-axis'
const ITEM_DISABLED = 'data-dnd-disabled'
const HANDLE = 'data-dnd-handle'
const HAS_HANDLE = 'data-dnd-has-handle'
// Auto-scroll: pixels from an edge where scrolling starts, and the top speed per frame.
const SCROLL_EDGE = 40
const SCROLL_MAX = 20
// A finger that moves this far before `pressDelay` is scrolling.
const TOUCH_TOLERANCE = 5

interface Held {
  readonly id: string
  readonly element: HTMLElement
}

const pointOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY })

const isPickKey = (key: string): boolean => key === ' ' || key === 'Enter'

/**
 * The enabled item `target` grabs, within `root`: any part of an item, or for
 * an item with a handle, only its handle. `grip` is the element that takes the
 * keyboard: the handle, or the item itself.
 */
const itemAt = (root: HTMLElement, target: EventTarget | null): (Held & { readonly grip: HTMLElement }) | null => {
  if (!(target instanceof Element)) return null

  const element = target.closest<HTMLElement>(`[${ITEM}]`)
  const id = element?.getAttribute(ITEM)

  if (element === null || id === null || id === undefined || !root.contains(element)) return null
  if (element.hasAttribute(ITEM_DISABLED)) return null
  if (!element.hasAttribute(HAS_HANDLE)) return { id, element, grip: element }

  const handle = target.closest<HTMLElement>(`[${HANDLE}]`)

  return handle !== null && element.contains(handle) && handle.getAttribute(HANDLE) === id
    ? { id, element, grip: handle }
    : null
}

/** Where `element` is laid out, without a transform the drag put on it. */
const naturalRect = (element: HTMLElement): DOMRect => {
  const { transform } = element.style

  if (transform === '') return element.getBoundingClientRect()

  element.style.transform = ''

  const rect = element.getBoundingClientRect()

  element.style.transform = transform

  return rect
}

const zoneElement = (root: HTMLElement, id: string): HTMLElement | null =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${ZONE}]`)).find((element) => element.getAttribute(ZONE) === id) ?? null

const scrolls = (value: string): boolean => value === 'auto' || value === 'scroll' || value === 'overlay'

/**
 * The panes that can scroll around `elements`, innermost first and each once,
 * then the page. Called with the zone under the pointer and the dragged item,
 * so a list inside the area scrolls as well as the page around it.
 */
const scrollPanesOf = (elements: ReadonlyArray<HTMLElement>): Array<HTMLElement> => {
  const panes: Array<HTMLElement> = []

  for (const start of elements) {
    for (let element: HTMLElement | null = start; element !== null; element = element.parentElement) {
      if (panes.includes(element)) continue

      const style = getComputedStyle(element)
      const vertical = scrolls(style.overflowY) && element.scrollHeight > element.clientHeight
      const sideways = scrolls(style.overflowX) && element.scrollWidth > element.clientWidth

      if (vertical || sideways) panes.push(element)
    }
  }

  const page = elements[0]?.ownerDocument.scrollingElement

  if (page instanceof HTMLElement && !panes.includes(page)) panes.push(page)

  return panes
}

const paneRect = (pane: HTMLElement): DOMRect => {
  const view = pane.ownerDocument.defaultView

  return pane === pane.ownerDocument.scrollingElement && view !== null
    ? DOMRect.fromRect({ x: 0, y: 0, width: view.innerWidth, height: view.innerHeight })
    : pane.getBoundingClientRect()
}

/** Scrolls the innermost pane that can move as `point` asks. Whether anything moved. */
const scrollTowards = (panes: ReadonlyArray<HTMLElement>, point: Point): boolean => {
  for (const pane of panes) {
    const speed = scrollSpeed(point, paneRect(pane), SCROLL_EDGE, SCROLL_MAX)

    if (speed.x === 0 && speed.y === 0) continue

    const { scrollLeft, scrollTop } = pane

    pane.scrollTop = scrollTop + speed.y
    pane.scrollLeft = scrollLeft + speed.x

    if (pane.scrollTop !== scrollTop || pane.scrollLeft !== scrollLeft) return true
  }

  return false
}

const clips = (value: string): boolean =>
  value === 'hidden' || value === 'clip' || value === 'auto' || value === 'scroll' || value === 'overlay'

/**
 * The part of `rect` a user can see: clipped by every pane around `element`
 * that hides or scrolls its overflow. Null when none of it shows.
 */
const visiblePart = (element: HTMLElement, rect: Rect): Rect | null => {
  let shown: Rect | null = rect

  for (let pane = element.parentElement; pane !== null && shown !== null; pane = pane.parentElement) {
    const style = getComputedStyle(pane)

    if (!clips(style.overflowX) && !clips(style.overflowY)) continue

    const { left, top, width, height } = pane.getBoundingClientRect()

    shown = clip(shown, { left, top, width, height })
  }

  return shown
}

/**
 * The zones in document order that show on screen, without those inside the
 * held item: an item cannot be dropped into itself.
 */
const zonesIn = (root: HTMLElement, held: HTMLElement): Array<ZoneBox> =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${ZONE}]`)).flatMap((element) => {
    const id = element.getAttribute(ZONE)
    const axis = element.getAttribute(AXIS)

    if (id === null || (element !== held && held.contains(element))) return []

    // The held item measures where it sits in the list, not where a drag moved it.
    const { left, top, width, height } = element === held ? naturalRect(element) : element.getBoundingClientRect()
    const rect = { left, top, width, height }
    const visible = visiblePart(element, rect)

    if (visible === null) return []

    // The zone around this one, such as a card's column.
    const holder = element.parentElement?.closest<HTMLElement>(`[${ZONE}]`)
    const parent = holder !== null && holder !== undefined && root.contains(holder) ? holder.getAttribute(ZONE) : null

    return [{ id, rect, visible, parent, axis: axis === 'vertical' || axis === 'horizontal' ? axis : null }]
  })

/**
 * The keyboard's stops, in document order. A sortable zone before the item's
 * own lands before it and one after lands after it, so each arrow press moves
 * the item one place.
 */
const keyboardStops = (zones: ReadonlyArray<ZoneBox>, item: string): { stops: Array<Target>; start: number } => {
  const own = zones.findIndex((zone) => zone.id === item)
  const stops = zones.map(
    (zone, index): Target => ({
      zone: zone.id,
      placement: zone.axis === null ? 'inside' : index > own && own >= 0 ? 'after' : 'before',
    }),
  )

  return { stops, start: own }
}

interface Press {
  readonly pointerId: number
  readonly held: Held
  readonly origin: Point
  readonly delayed: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

// Presses on items, the pointer's moves and release anywhere in the
// document, and the keys on a focused item. Everything it learns goes to
// `update` as a message; the Model decides what the drag looks like.
const TrackDrag = Mount.makeStream(
  'TrackDrag',
  {
    args: {
      disabled: Schema.Boolean,
      distance: Schema.Finite,
      pressDelay: Schema.Finite,
      collision: Collision,
      autoScroll: Schema.Boolean,
      dragging: Schema.Boolean,
    },
  },
  (root: unknown, args, changes) =>
    Stream.callback<DragAreaMessage>((queue) =>
      Effect.gen(function* () {
        // The root part takes any element, so its node arrives untyped.
        if (!(root instanceof HTMLElement)) {
          return yield* Effect.die(new Error('DragArea: the root part must be an HTML element'))
        }

        const node = root
        const document = node.ownerDocument
        let settings = args
        let press: Press | null = null
        let pointerDrag: { readonly pointerId: number; readonly held: Held } | null = null
        let keyboard: { readonly held: Held; readonly stops: Array<Target>; index: number } | null = null
        // The pointer's last place in a drag, and the auto-scroll frame waiting to run.
        let last: Point = { x: 0, y: 0 }
        let frame: number | undefined
        const view = document.defaultView
        // The document's listeners for the press or drag under way.
        let listening: AbortController | undefined
        const send = (message: DragAreaMessage) => {
          Queue.offerUnsafe(queue, message)
        }

        const targetFor = (point: Point, held: HTMLElement) =>
          targetAt(point, zonesIn(node, held), settings.collision)

        const report = (point: Point, held: Held) => {
          const natural = naturalRect(held.element)

          send(
            DragAreaMessage.Moved({
              ...point,
              left: natural.left,
              top: natural.top,
              over: targetFor(point, held.element),
            }),
          )
        }

        // While the pointer holds near an edge, scroll a frame at a time and
        // find the target again under the content that moved.
        const autoScroll = () => {
          frame = undefined

          if (pointerDrag === null || !settings.autoScroll || view === null) return
          const over = targetFor(last, pointerDrag.held.element)
          const zone = over === null ? null : zoneElement(node, over.zone)
          const around = zone === null ? [pointerDrag.held.element] : [zone, pointerDrag.held.element]

          if (scrollTowards(scrollPanesOf(around), last)) report(last, pointerDrag.held)

          frame = view.requestAnimationFrame(autoScroll)
        }

        const endPress = () => {
          if (frame !== undefined) view?.cancelAnimationFrame(frame)
          frame = undefined
          if (press?.timer !== undefined) clearTimeout(press.timer)
          if (pointerDrag !== null && node.hasPointerCapture?.(pointerDrag.pointerId) === true) {
            node.releasePointerCapture(pointerDrag.pointerId)
          }

          press = null
          pointerDrag = null
          listening?.abort()
          listening = undefined
        }

        // The click that ends a drag is not a click on the item.
        const swallowNextClick = () => {
          const swallow = (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
          }

          document.addEventListener('click', swallow, { capture: true, once: true })
          setTimeout(() => {
            document.removeEventListener('click', swallow, { capture: true })
          }, 0)
        }

        const start = (current: Press, point: Point) => {
          const rect = current.held.element.getBoundingClientRect()

          pointerDrag = { pointerId: current.pointerId, held: current.held }
          last = point
          document.getSelection()?.removeAllRanges()
          press = null
          node.setPointerCapture?.(current.pointerId)
          send(
            DragAreaMessage.PickedUp({
              drag: {
                item: current.held.id,
                via: 'pointer',
                x: point.x,
                y: point.y,
                grabX: current.origin.x - rect.left,
                grabY: current.origin.y - rect.top,
                width: rect.width,
                height: rect.height,
                left: rect.left,
                top: rect.top,
                over: targetFor(point, current.held.element),
              },
            }),
          )
          if (view !== null && frame === undefined) frame = view.requestAnimationFrame(autoScroll)
        }

        const onMove = (event: PointerEvent) => {
          const point = pointOf(event)

          if (pointerDrag !== null && event.pointerId === pointerDrag.pointerId) {
            event.preventDefault()
            last = point
            report(point, pointerDrag.held)

            return
          }

          if (press === null || event.pointerId !== press.pointerId) return
          if (press.delayed) {
            // A finger that moves before the hold ends is scrolling.
            if (movedPast(press.origin, point, TOUCH_TOLERANCE)) endPress()

            return
          }
          if (movedPast(press.origin, point, settings.distance)) start(press, point)
        }

        const onUp = (event: PointerEvent) => {
          if (pointerDrag !== null && event.pointerId === pointerDrag.pointerId) {
            const point = pointOf(event)
            const over = targetFor(point, pointerDrag.held.element)

            swallowNextClick()
            endPress()
            send(DragAreaMessage.Released({ over }))

            return
          }

          if (press !== null && event.pointerId === press.pointerId) endPress()
        }

        const onCancel = (event: PointerEvent) => {
          const dragging = pointerDrag !== null && event.pointerId === pointerDrag.pointerId

          if (dragging || (press !== null && event.pointerId === press.pointerId)) endPress()
          if (dragging) send(DragAreaMessage.Cancelled())
        }

        const onEscape = (event: KeyboardEvent) => {
          if (event.key !== 'Escape' || pointerDrag === null) return

          event.preventDefault()
          endPress()
          send(DragAreaMessage.Cancelled())
        }

        // The browser's own drag of selected text or an image would cancel ours.
        const blockNativeDrag = (event: Event) => {
          event.preventDefault()
        }

        // Nor may a drag select text as it goes.
        const blockSelection = (event: Event) => {
          if (pointerDrag !== null) event.preventDefault()
        }

        // A touch drag must not scroll the page under it.
        const holdPage = (event: TouchEvent) => {
          if (pointerDrag !== null) event.preventDefault()
        }

        const onDown = (event: PointerEvent) => {
          if (settings.disabled || press !== null || pointerDrag !== null || keyboard !== null) return
          if (event.button !== 0 || event.defaultPrevented) return

          const held = itemAt(node, event.target)

          if (held === null) return

          const delayed = event.pointerType === 'touch' && settings.pressDelay > 0
          const current: Press = { pointerId: event.pointerId, held, origin: pointOf(event), delayed, timer: undefined }

          press = current
          listening = new AbortController()

          const { signal } = listening

          document.addEventListener('pointermove', onMove, { signal })
          document.addEventListener('pointerup', onUp, { signal })
          document.addEventListener('pointercancel', onCancel, { signal })
          document.addEventListener('keydown', onEscape, { signal })
          document.addEventListener('touchmove', holdPage, { signal, passive: false })
          document.addEventListener('dragstart', blockNativeDrag, { signal, capture: true })
          document.addEventListener('selectstart', blockSelection, { signal, capture: true })

          if (delayed) {
            current.timer = setTimeout(() => {
              if (press === current) start(current, current.origin)
            }, settings.pressDelay)
          }
        }

        const step = (by: number) => {
          if (keyboard === null || keyboard.stops.length === 0) return

          keyboard.index = Math.min(keyboard.stops.length - 1, Math.max(0, keyboard.index + by))
          send(DragAreaMessage.Moved({ x: 0, y: 0, left: 0, top: 0, over: keyboard.stops[keyboard.index] ?? null }))
        }

        const onKey = (event: KeyboardEvent) => {
          if (keyboard !== null) {
            const { key } = event

            if (key === 'ArrowDown' || key === 'ArrowRight') step(1)
            else if (key === 'ArrowUp' || key === 'ArrowLeft') step(-1)
            else if (isPickKey(key)) {
              const over = keyboard.stops[keyboard.index] ?? null

              keyboard = null
              send(DragAreaMessage.Released({ over }))
            } else if (key === 'Escape' || key === 'Tab') {
              keyboard = null
              send(DragAreaMessage.Cancelled())
            } else return

            // Tab still moves focus after it cancels.
            if (key !== 'Tab') event.preventDefault()

            return
          }

          if (settings.disabled || pointerDrag !== null || !isPickKey(event.key)) return

          const held = itemAt(node, event.target)

          // Only a key on the item itself, or its handle: a button inside keeps its keys.
          if (held === null || held.grip !== event.target) return

          event.preventDefault()

          const { stops, start: index } = keyboardStops(zonesIn(node, held.element), held.id)

          keyboard = { held, stops, index }
          send(
            DragAreaMessage.PickedUp({
              drag: {
                item: held.id,
                via: 'keyboard',
                x: 0,
                y: 0,
                grabX: 0,
                grabY: 0,
                width: 0,
                height: 0,
                left: 0,
                top: 0,
                over: stops[index] ?? null,
              },
            }),
          )
        }

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            node.addEventListener('pointerdown', onDown)
            node.addEventListener('keydown', onKey)
          }),
          () =>
            Effect.sync(() => {
              node.removeEventListener('pointerdown', onDown)
              node.removeEventListener('keydown', onKey)
              endPress()
            }),
        )

        yield* Stream.runForEach(changes, (next) =>
          Effect.sync(() => {
            settings = next

            const active = pointerDrag !== null || keyboard !== null

            // An area disabled mid-drag puts the item back.
            if (next.disabled && active) {
              endPress()
              keyboard = null
              send(DragAreaMessage.Cancelled())
            }
          }),
        ).pipe(Effect.forkScoped)
      }),
    ),
)

// -- parts -------------------------------------------------------------------

const flag = (on: boolean): string | undefined => (on ? '' : undefined)

const withStyle = (consumer: string | undefined, own: string): string =>
  consumer === undefined || consumer.trim() === '' ? own : `${consumer.replace(/;\s*$/u, '')};${own}`

const visuallyHidden =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'

const previewStyle = (drag: Drag): string =>
  [
    'position:fixed',
    'box-sizing:border-box',
    'left:0',
    'top:0',
    `width:${drag.width}px`,
    `height:${drag.height}px`,
    `transform:translate3d(${drag.x - drag.grabX}px,${drag.y - drag.grabY}px,0)`,
    'pointer-events:none',
    'z-index:2147483647',
  ].join(';')

// The item itself, moved to follow the pointer from where it sits.
const followStyle = (drag: Drag): string =>
  [
    `transform:translate3d(${drag.x - drag.grabX - drag.left}px,${drag.y - drag.grabY - drag.top}px,0)`,
    'position:relative',
    'z-index:1',
    'pointer-events:none',
  ].join(';')

/** Options for one item: a drag handle inside it, or the item alone disabled. */
export interface ItemOptions {
  /** Drag only from the item's `handle` part, which also takes focus. */
  readonly handle?: boolean
  readonly disabled?: boolean
}

const finished = (props: DragAreaProps, item: string, announcement: string): DragAreaModel => ({
  drag: null,
  announcement: phrase(announcement, props, item),
})

/**
 * A headless drag area. Call it with the consumer's `h`, the `props`, an
 * `onEmit` for `Dropped` and `PutBack`, and a `view` closure that draws the
 * parts: `dragArea.item(h.li, id)`, `dragArea.zone(h.ul, id)`, and
 * `dragArea.zone(h.li, id, "vertical")` for a sortable row.
 *
 * The parts also return `dragging`, the id being dragged or `null`, `over`,
 * the target under it, and `via`, `"pointer"` or `"keyboard"`, for markup
 * that depends on them. Draw `preview` only while `via` is `"pointer"`.
 */
export const DragArea = Html.component({
  name: 'DragArea',
  props: DragAreaProps,
  model: DragAreaModel,
  message: DragAreaMessage,
  events: DragAreaEvents,
  restore: false,
}).make({
  init: () => ({ drag: null, announcement: '' }),
  update: {
    PickedUp: ($, { drag }) =>
      $.props.disabled === true || $.model.drag !== null
        ? $.model
        : $.set({ drag, announcement: phrase(phrasesOf($.props).pickedUp, $.props, drag.item) }),
    Moved: ($, { x, y, left, top, over }) => {
      const { drag } = $.model

      if (drag === null) return $.model

      const announcement = sameTarget(drag.over, over) ? $.model.announcement : overPhrase($.props, drag.item, over)

      return $.set({ drag: { ...drag, x, y, left, top, over }, announcement })
    },
    Released: ($, { over }) => {
      const { drag } = $.model

      if (drag === null) return $.model
      if (over === null) {
        return $.set(finished($.props, drag.item, phrasesOf($.props).putBack)).emit(
          DragAreaEvents.PutBack({ item: drag.item }),
        )
      }

      return $.set({ drag: null, announcement: phrase(phrasesOf($.props).dropped, $.props, drag.item, over.zone) }).emit(
        DragAreaEvents.Dropped({ item: drag.item, zone: over.zone, placement: over.placement }),
      )
    },
    Cancelled: ($) => {
      const { drag } = $.model

      if (drag === null) return $.model

      return $.set(finished($.props, drag.item, phrasesOf($.props).putBack)).emit(
        DragAreaEvents.PutBack({ item: drag.item }),
      )
    },
  },
  parts: (p, model) => {
    const disabled = p.props.disabled === true
    const { drag } = model
    const over = drag?.over ?? null
    const instructionsId = p.id('instructions')
    const follow = p.props.follow ?? 'preview'
    // What makes an element the one a user grabs: focus, and what a screen reader says.
    const grabAttrs = (id: string, off: boolean) => ({
      tabindex: off ? undefined : '0',
      'aria-roledescription': 'draggable',
      'aria-describedby': instructionsId,
      'aria-pressed': drag?.item === id ? 'true' : undefined,
      'aria-disabled': off ? 'true' : undefined,
    })

    return {
      dragging: drag === null ? null : drag.item,
      over,
      via: drag === null ? null : drag.via,
      root: p.part((b) =>
        b
          .attrs({ 'data-dragging': flag(drag !== null), 'data-disabled': flag(disabled) })
          .onMount(
            TrackDrag({
              disabled,
              distance: p.props.distance ?? 8,
              pressDelay: p.props.pressDelay ?? 0,
              collision: p.props.collision ?? 'pointer',
              autoScroll: p.props.autoScroll ?? true,
              dragging: drag !== null,
            }),
          ),
      ),
      item: p.part((b, id: string, options?: ItemOptions) => {
        const off = disabled || options?.disabled === true
        const handled = options?.handle === true
        const moved = follow === 'item' && drag?.via === 'pointer' && drag.item === id

        return b
          .attrs({
            [ITEM]: id,
            [ITEM_DISABLED]: flag(off),
            [HAS_HANDLE]: flag(handled),
            'data-dragging': flag(drag?.item === id),
            ...(handled ? {} : grabAttrs(id, off)),
          })
          .forward((node) =>
            moved ? node.attr('style', withStyle(node.elementAttrs.style, followStyle(drag))) : node,
          )
      }),
      handle: p.part((b, id: string) => b.attrs({ [HANDLE]: id, ...grabAttrs(id, disabled) })),
      zone: p.part((b, id: string, axis?: Axis) =>
        b.attrs({
          [ZONE]: id,
          [AXIS]: axis,
          'data-over': flag(over?.zone === id),
          'data-placement': over?.zone === id ? over.placement : undefined,
        }),
      ),
      preview: p.part((b) =>
        b
          .attr('aria-hidden', 'true')
          .forward((node) =>
            drag === null || drag.via !== 'pointer'
              ? node.attr('hidden', '')
              : node.attr('style', withStyle(node.elementAttrs.style, previewStyle(drag))),
          ),
      ),
      announcer: p.part((b) =>
        b
          .attrs({ role: 'status', 'aria-live': 'assertive', 'aria-atomic': 'true' })
          .forward((node) => node.attr('style', withStyle(node.elementAttrs.style, visuallyHidden)))
          .children(model.announcement),
      ),
      instructions: p.part((b) =>
        b
          .attr('id', instructionsId)
          .forward((node) => node.attr('style', withStyle(node.elementAttrs.style, visuallyHidden)))
          .children(phrasesOf(p.props).instructions),
      ),
    }
  },
})
