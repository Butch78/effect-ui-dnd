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
import { Axis, movedPast, Target, targetAt, type Point, type ZoneBox } from './geometry.ts'

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
  Moved: { x: Schema.Finite, y: Schema.Finite, over: Schema.NullOr(Target) },
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
// A finger that moves this far before `pressDelay` is scrolling.
const TOUCH_TOLERANCE = 5

interface Held {
  readonly id: string
  readonly element: HTMLElement
}

const pointOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY })

const isPickKey = (key: string): boolean => key === ' ' || key === 'Enter'

/** The enabled item `target` is in, within `root`. */
const itemAt = (root: HTMLElement, target: EventTarget | null): Held | null => {
  if (!(target instanceof Element)) return null

  const element = target.closest<HTMLElement>(`[${ITEM}]`)
  const id = element?.getAttribute(ITEM)

  if (element === null || id === null || id === undefined || !root.contains(element)) return null
  if (element.hasAttribute(ITEM_DISABLED)) return null

  return { id, element }
}

/** The zones in document order, without those inside the held item: an item cannot be dropped into itself. */
const zonesIn = (root: HTMLElement, held: HTMLElement): Array<ZoneBox> =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${ZONE}]`)).flatMap((element) => {
    const id = element.getAttribute(ZONE)
    const axis = element.getAttribute(AXIS)

    if (id === null || (element !== held && held.contains(element))) return []

    const { left, top, width, height } = element.getBoundingClientRect()

    return [{ id, rect: { left, top, width, height }, axis: axis === 'vertical' || axis === 'horizontal' ? axis : null }]
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
        // The document's listeners for the press or drag under way.
        let listening: AbortController | undefined
        const send = (message: DragAreaMessage) => {
          Queue.offerUnsafe(queue, message)
        }

        const endPress = () => {
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
                over: targetAt(point, zonesIn(node, current.held.element)),
              },
            }),
          )
        }

        const onMove = (event: PointerEvent) => {
          const point = pointOf(event)

          if (pointerDrag !== null && event.pointerId === pointerDrag.pointerId) {
            event.preventDefault()
            send(DragAreaMessage.Moved({ ...point, over: targetAt(point, zonesIn(node, pointerDrag.held.element)) }))

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
            const over = targetAt(point, zonesIn(node, pointerDrag.held.element))

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

          if (delayed) {
            current.timer = setTimeout(() => {
              if (press === current) start(current, current.origin)
            }, settings.pressDelay)
          }
        }

        const step = (by: number) => {
          if (keyboard === null || keyboard.stops.length === 0) return

          keyboard.index = Math.min(keyboard.stops.length - 1, Math.max(0, keyboard.index + by))
          send(DragAreaMessage.Moved({ x: 0, y: 0, over: keyboard.stops[keyboard.index] ?? null }))
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

          // Only a key on the item itself: a button inside the item keeps its keys.
          if (held === null || held.element !== event.target) return

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
    Moved: ($, { x, y, over }) => {
      const { drag } = $.model

      if (drag === null) return $.model

      const announcement = sameTarget(drag.over, over) ? $.model.announcement : overPhrase($.props, drag.item, over)

      return $.set({ drag: { ...drag, x, y, over }, announcement })
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
              dragging: drag !== null,
            }),
          ),
      ),
      item: p.part((b, id: string) =>
        b.attrs({
          [ITEM]: id,
          [ITEM_DISABLED]: flag(disabled),
          tabindex: disabled ? undefined : '0',
          'aria-roledescription': 'draggable',
          'aria-describedby': instructionsId,
          'aria-pressed': drag?.item === id ? 'true' : undefined,
          'data-dragging': flag(drag?.item === id),
        }),
      ),
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
