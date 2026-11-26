# effect-ui-dnd

Drag and drop for [Effect UI](https://github.com/Effect-TS/ui), by mouse, touch and keyboard: drop zones and sortable lists, with screen reader announcements. Effect v4, headless, no other dependencies.

Status: early. Effect UI itself is a public preview and not on npm yet, so this package follows its snapshots.

## Install

```sh
pnpm add effect https://pkg.pr.new/Effect-TS/ui/@effect/ui@87a704b
pnpm add github:Butch78/effect-ui-dnd
```

## Use

`DragArea` is a headless component: you draw the markup, it adds the behaviour. Items and zones carry string ids, and a finished drop arrives as a `Dropped` event with the item, the zone and the placement (`before`, `after` or `inside`). A zone with an axis is one entry of a sortable list; `reorder` turns a drop on it into the new order.

```ts
import { DragArea, reorder } from "effect-ui-dnd";

DragArea(h, {
  props: { labels: { write: "Write the brief", bin: "the bin" } },
  onEmit: (event) =>
    event._tag === "Dropped"
      ? Message.DroppedTask({ item: event.item, zone: event.zone, placement: event.placement })
      : Message.PutBackTask(),
  view: (dragArea) =>
    dragArea
      .root(h.main)
      .children(
        h.ul.children(
          model.order.map((id) =>
            dragArea.zone(dragArea.item(h.li.key(id), id), id, "vertical").children(titleOf(id)),
          ),
        ),
        dragArea.zone(h.section, "bin").children("Bin"),
        dragArea.via === "pointer" && dragArea.dragging !== null
          ? dragArea.preview(h.div).children(titleOf(dragArea.dragging))
          : h.span,
        dragArea.announcer(h.div),
        dragArea.instructions(h.div),
      ),
});

// In update:
DroppedTask: ($, drop) => $.evolve({ order: (order) => reorder(order, drop) });
```

`example/main.ts` is a complete page: `pnpm example`.

## Parts

| Part           | Use                                                                 |
| -------------- | ------------------------------------------------------------------- |
| `root`         | holds every item and zone; listens for presses and keys             |
| `item`         | a draggable element, by id; focusable, with ARIA for screen readers |
| `zone`         | a drop target, by id; give it an axis to make it a sortable entry   |
| `preview`      | the floating copy under the pointer, sized like the item            |
| `announcer`    | a visually hidden live region that says what is happening           |
| `instructions` | visually hidden keyboard instructions the items point to            |

The parts also return `dragging` (the item id or `null`), `over` (the target under it) and `via` (`"pointer"` or `"keyboard"`).

Style with data attributes: `data-dragging` on the root and the dragged item, `data-over` and `data-placement` on the zone under the drag.

## Props

| Prop         | Default | Meaning                                                                   |
| ------------ | ------- | ------------------------------------------------------------------------- |
| `distance`   | `8`     | pixels a mouse or pen moves before a press becomes a drag                 |
| `pressDelay` | `0`     | milliseconds a finger holds still before a touch drags; a swipe scrolls   |
| `labels`     | none    | spoken names of items and zones, by id                                    |
| `phrases`    | English | what the screen reader hears; `{item}` and `{zone}` take the spoken names |
| `disabled`   | `false` | no drags; a drag under way is put back                                    |

## Keyboard

Space or Enter on a focused item picks it up. The arrow keys step through the zones in document order (in a sortable list, one place at a time). Space or Enter drops; Escape or Tab puts it back.

## Develop

```sh
pnpm install
pnpm check      # effect-tsgo type check with Effect diagnostics, then the tests
pnpm example    # the example page
```

## License

MIT
