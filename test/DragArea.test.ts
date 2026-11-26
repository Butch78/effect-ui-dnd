// @vitest-environment happy-dom
import { UiSchema } from "@effect/ui";
import { BrowserHost, Html } from "@effect/ui/html";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { DragArea, reorder } from "../src/index.ts";

const tick = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));

const container = Effect.acquireRelease(
  Effect.sync(() => document.body.appendChild(document.createElement("div"))),
  (element) => Effect.sync(() => element.remove()),
);

const Message = UiSchema.TaggedEnum({
  Dropped: { item: Schema.String, zone: Schema.String, placement: Schema.String },
  PutBack: { item: Schema.String },
});

const PageProps = Schema.Struct({
    pressDelay: Schema.optional(Schema.Finite),
    collision: Schema.optional(Schema.Literals(["pointer", "closest"])),
    follow: Schema.optional(Schema.Literals(["preview", "item"])),
    autoScroll: Schema.optional(Schema.Boolean),
    handles: Schema.optional(Schema.Boolean),
    locked: Schema.optional(Schema.String),
})

const Page = Html.component({
  name: "Page",
  props: PageProps,
  model: Schema.Struct({ order: Schema.Array(Schema.String), log: Schema.Array(Schema.String) }),
  message: Message,
}).make({
  init: () => ({ order: ["a", "b", "c"], log: [] }),
  update: {
    Dropped: ($, { item, zone, placement }) =>
      $.set({
        order:
          placement === "before" || placement === "after"
            ? reorder($.model.order, { item, zone, placement })
            : $.model.order.filter((id) => id !== item),
        log: [...$.model.log, `dropped ${item} ${placement} ${zone}`],
      }),
    PutBack: ($, { item }) => $.evolve({ log: (log) => [...log, `put back ${item}`] }),
  },
  view: (h, model) =>
    h.div.children(
      DragArea(h, {
        props: {
          labels: { a: "Alpha", b: "Beta", c: "Gamma", trash: "the bin" },
          pressDelay: h.props.pressDelay,
          collision: h.props.collision,
          follow: h.props.follow,
          autoScroll: h.props.autoScroll,
        },
        onEmit: (event) =>
          event._tag === "Dropped"
            ? Message.Dropped({ item: event.item, zone: event.zone, placement: event.placement })
            : Message.PutBack({ item: event.item }),
        view: (dragArea) =>
          dragArea.root(h.div.class("area")).children(
            h.div.class("pane").attr("style", "overflow-y:auto").children(
              h.ul.children(
                model.order.map((id) =>
                  dragArea
                    .zone(
                      dragArea.item(h.li.key(id), id, {
                        handle: h.props.handles === true,
                        disabled: h.props.locked === id,
                      }),
                      id,
                      "vertical",
                    )
                    .class(`row row-${id}`)
                    .children(
                      h.props.handles === true
                        ? dragArea.handle(h.span.class(`grip grip-${id}`), id).children("grip")
                        : h.span,
                      h.span.children(id),
                    ),
                ),
              ),
            ),
            dragArea.zone(h.div.class("trash"), "trash").children("Trash"),
            dragArea.dragging === null
              ? h.span
              : dragArea.preview(h.div.class("preview")).children(dragArea.dragging),
            dragArea.announcer(h.div.class("announcer")),
            dragArea.instructions(h.div.class("instructions")),
          ),
      }),
      h.ol
        .class("log")
        .children(model.log.map((line, index) => h.li.key(String(index)).children(line))),
    ),
});

// happy-dom has no layout: give each row and the bin a place on screen.
// Rows are 40 px tall from the top; the bin sits below them.
const layOut = (app: HTMLElement) => {
  const rect = (left: number, top: number, width: number, height: number) => () =>
    DOMRect.fromRect({ x: left, y: top, width, height });

  app.querySelectorAll<HTMLElement>(".row").forEach((row) => {
    const index = ["a", "b", "c"].indexOf(row.getAttribute("data-dnd-item") ?? "");

    row.getBoundingClientRect = rect(0, index * 40, 200, 40);
  });

  // The pane scrolls, so it clips the rows: it shows all three.
  const pane = app.querySelector<HTMLElement>(".pane");

  if (pane !== null) pane.getBoundingClientRect = rect(0, 0, 200, 120);

  const trash = app.querySelector<HTMLElement>(".trash");

  if (trash !== null) trash.getBoundingClientRect = rect(0, 200, 200, 100);
};

const pointer = (target: EventTarget, type: string, x: number, y: number, pointerType = "mouse") =>
  target.dispatchEvent(
    new PointerEvent(type, {
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType,
      bubbles: true,
      cancelable: true,
    }),
  );

const key = (target: EventTarget, name: string) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );

const rowsOf = (app: HTMLElement) =>
  Array.from(app.querySelectorAll(".row")).map((row) => row.getAttribute("data-dnd-item"));
const logOf = (app: HTMLElement) =>
  Array.from(app.querySelectorAll(".log li")).map((line) => line.textContent);
const textOf = (app: HTMLElement, selector: string) =>
  app.querySelector(selector)?.textContent ?? null;

const mounted = (props: typeof PageProps.Type = {}) =>
  Effect.gen(function* () {
    const app = yield* container;

    yield* BrowserHost.mountEffect(Page, props, app);
    yield* tick;
    layOut(app);

    return app;
  });

describe("DragArea by pointer", () => {
  it.effect("reorders a sortable list: dropping row a below row c moves it to the end", () =>
    Effect.gen(function* () {
      const app = yield* mounted();
      const rowA = app.querySelector(".row-a")!;

      pointer(rowA, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 30);
      yield* tick;
      assert.strictEqual(app.querySelector(".area")?.hasAttribute("data-dragging"), true);
      assert.strictEqual(textOf(app, ".preview"), "a");
      assert.strictEqual(textOf(app, ".announcer"), "Picked up Alpha.");

      pointer(document, "pointermove", 10, 110);
      yield* tick;
      assert.strictEqual(app.querySelector(".row-c")?.getAttribute("data-placement"), "after");
      assert.strictEqual(textOf(app, ".announcer"), "Alpha is after Gamma.");

      pointer(document, "pointerup", 10, 110);
      yield* tick;
      layOut(app);
      assert.deepStrictEqual(rowsOf(app), ["b", "c", "a"]);
      assert.deepStrictEqual(logOf(app), ["dropped a after c"]);
      assert.strictEqual(textOf(app, ".announcer"), "Alpha was dropped on Gamma.");
      assert.strictEqual(app.querySelector(".area")?.hasAttribute("data-dragging"), false);
    }).pipe(Effect.scoped),
  );

  it.effect("drops into a plain zone", () =>
    Effect.gen(function* () {
      const app = yield* mounted();

      pointer(app.querySelector(".row-b")!, "pointerdown", 10, 50);
      pointer(document, "pointermove", 10, 250);
      pointer(document, "pointerup", 10, 250);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["dropped b inside trash"]);
      assert.deepStrictEqual(rowsOf(app), ["a", "c"]);
    }).pipe(Effect.scoped),
  );

  it.effect("a press that moves less than the distance is a click, not a drag", () =>
    Effect.gen(function* () {
      const app = yield* mounted();

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 13, 13);
      pointer(document, "pointerup", 13, 13);
      yield* tick;
      assert.deepStrictEqual(logOf(app), []);
      assert.strictEqual(app.querySelector(".area")?.hasAttribute("data-dragging"), false);
    }).pipe(Effect.scoped),
  );

  it.effect("a drop outside every zone puts the item back", () =>
    Effect.gen(function* () {
      const app = yield* mounted();

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 500, 500);
      pointer(document, "pointerup", 500, 500);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["put back a"]);
      assert.deepStrictEqual(rowsOf(app), ["a", "b", "c"]);
      assert.strictEqual(textOf(app, ".announcer"), "Alpha was put back.");
    }).pipe(Effect.scoped),
  );

  it.effect("Escape during a pointer drag puts the item back", () =>
    Effect.gen(function* () {
      const app = yield* mounted();

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 110);
      key(document, "Escape");
      pointer(document, "pointerup", 10, 110);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["put back a"]);
      assert.deepStrictEqual(rowsOf(app), ["a", "b", "c"]);
    }).pipe(Effect.scoped),
  );

  it.effect("a touch with pressDelay scrolls when the finger moves before the hold ends", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ pressDelay: 40 });

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10, "touch");
      pointer(document, "pointermove", 10, 30, "touch");
      yield* tick;
      pointer(document, "pointermove", 10, 110, "touch");
      pointer(document, "pointerup", 10, 110, "touch");
      yield* tick;
      assert.deepStrictEqual(logOf(app), []);
    }).pipe(Effect.scoped),
  );

  it.effect("a touch with pressDelay drags once the finger holds still", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ pressDelay: 20 });

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10, "touch");
      yield* tick;
      assert.strictEqual(app.querySelector(".area")?.hasAttribute("data-dragging"), true);
      pointer(document, "pointermove", 10, 110, "touch");
      pointer(document, "pointerup", 10, 110, "touch");
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["dropped a after c"]);
    }).pipe(Effect.scoped),
  );
});

describe("DragArea and the browser's own dragging", () => {
  it.effect("a press stops the browser starting a native drag of selected text, and clears the selection on drag", () =>
    Effect.gen(function* () {
      const app = yield* mounted();
      const rowA = app.querySelector(".row-a")!;
      const nativeDrag = () => new Event("dragstart", { bubbles: true, cancelable: true });
      const untouched = nativeDrag();

      rowA.dispatchEvent(untouched);
      assert.strictEqual(untouched.defaultPrevented, false);

      document.getSelection()?.selectAllChildren(app);
      pointer(rowA, "pointerdown", 10, 10);

      const during = nativeDrag();

      rowA.dispatchEvent(during);
      assert.strictEqual(during.defaultPrevented, true);
      pointer(document, "pointermove", 10, 110);
      yield* tick;
      assert.strictEqual(document.getSelection()?.toString(), "");
      pointer(document, "pointerup", 10, 110);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["dropped a after c"]);
    }).pipe(Effect.scoped),
  );
});

describe("DragArea by keyboard", () => {
  it.effect("Space picks up, arrows move one place at a time, Space drops", () =>
    Effect.gen(function* () {
      const app = yield* mounted();
      const rowA = app.querySelector<HTMLElement>(".row-a")!;

      assert.strictEqual(rowA.getAttribute("tabindex"), "0");
      assert.strictEqual(
        app.querySelector(`#${rowA.getAttribute("aria-describedby")}`)?.className,
        "instructions",
      );

      key(rowA, " ");
      yield* tick;
      assert.strictEqual(textOf(app, ".announcer"), "Picked up Alpha.");
      assert.strictEqual(rowA.getAttribute("aria-pressed"), "true");
      // No floating copy for a keyboard drag.
      assert.strictEqual(app.querySelector(".preview")?.hasAttribute("hidden"), true);

      key(rowA, "ArrowDown");
      yield* tick;
      assert.strictEqual(textOf(app, ".announcer"), "Alpha is after Beta.");

      key(rowA, " ");
      yield* tick;
      assert.deepStrictEqual(rowsOf(app), ["b", "a", "c"]);
      assert.deepStrictEqual(logOf(app), ["dropped a after b"]);
    }).pipe(Effect.scoped),
  );

  it.effect("the arrows reach a plain zone after the list", () =>
    Effect.gen(function* () {
      const app = yield* mounted();
      const rowC = app.querySelector<HTMLElement>(".row-c")!;

      key(rowC, "Enter");
      key(rowC, "ArrowDown");
      yield* tick;
      assert.strictEqual(textOf(app, ".announcer"), "Gamma is over the bin.");
      key(rowC, "Enter");
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["dropped c inside trash"]);
    }).pipe(Effect.scoped),
  );

  it.effect("Escape puts a keyboard drag back", () =>
    Effect.gen(function* () {
      const app = yield* mounted();
      const rowB = app.querySelector<HTMLElement>(".row-b")!;

      key(rowB, " ");
      key(rowB, "ArrowUp");
      key(rowB, "Escape");
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["put back b"]);
      assert.deepStrictEqual(rowsOf(app), ["a", "b", "c"]);
    }).pipe(Effect.scoped),
  );
});

describe("DragArea options", () => {
  it.effect("collision closest drops in the gap between the list and the bin on the nearest row", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ collision: "closest" });

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 150);
      pointer(document, "pointerup", 10, 150);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["dropped a after c"]);
    }).pipe(Effect.scoped),
  );

  it.effect("the default collision puts an item back when dropped in that gap", () =>
    Effect.gen(function* () {
      const app = yield* mounted();

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 150);
      pointer(document, "pointerup", 10, 150);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["put back a"]);
    }).pipe(Effect.scoped),
  );

  it.effect("follow item moves the dragged item itself with the pointer", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ follow: "item" });
      const rowA = app.querySelector<HTMLElement>(".row-a")!;

      pointer(rowA, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 110);
      yield* tick;
      assert.match(rowA.style.transform, /^translate3d\(0px, ?100px, ?0(px)?\)$/);
      pointer(document, "pointerup", 10, 110);
      yield* tick;
      assert.strictEqual(app.querySelector<HTMLElement>(".row-a")?.style.transform, "");
      assert.deepStrictEqual(logOf(app), ["dropped a after c"]);
    }).pipe(Effect.scoped),
  );

  it.effect("with a handle, only a press on the handle drags", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ handles: true });

      pointer(app.querySelector(".row-a span:last-child")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 110);
      pointer(document, "pointerup", 10, 110);
      yield* tick;
      assert.deepStrictEqual(logOf(app), []);

      pointer(app.querySelector(".grip-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 110);
      pointer(document, "pointerup", 10, 110);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["dropped a after c"]);
    }).pipe(Effect.scoped),
  );

  it.effect("with a handle, the handle takes focus and the keyboard", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ handles: true });
      const rowA = app.querySelector<HTMLElement>(".row-a")!;
      const grip = app.querySelector<HTMLElement>(".grip-a")!;

      assert.isNull(rowA.getAttribute("tabindex"));
      assert.strictEqual(grip.getAttribute("tabindex"), "0");
      assert.strictEqual(grip.getAttribute("aria-roledescription"), "draggable");

      key(rowA, " ");
      yield* tick;
      assert.strictEqual(textOf(app, ".announcer"), "");

      key(grip, " ");
      key(grip, "ArrowDown");
      key(grip, " ");
      yield* tick;
      assert.deepStrictEqual(rowsOf(app), ["b", "a", "c"]);
    }).pipe(Effect.scoped),
  );

  it.effect("a disabled item does not drag; the others still do", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ locked: "b" });

      assert.isNull(app.querySelector(".row-b")!.getAttribute("tabindex"));
      pointer(app.querySelector(".row-b")!, "pointerdown", 10, 50);
      pointer(document, "pointermove", 10, 110);
      pointer(document, "pointerup", 10, 110);
      yield* tick;
      assert.deepStrictEqual(logOf(app), []);

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 110);
      pointer(document, "pointerup", 10, 110);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["dropped a after c"]);
    }).pipe(Effect.scoped),
  );
});

describe("DragArea auto-scroll", () => {
  // A pane 100 px tall showing the top of 1000 px of content.
  const scrollablePane = (app: HTMLElement) => {
    const pane = app.querySelector<HTMLElement>(".pane")!;
    let top = 0;

    pane.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 100 });
    Object.defineProperty(pane, "scrollHeight", { value: 1000 });
    Object.defineProperty(pane, "clientHeight", { value: 100 });
    Object.defineProperty(pane, "scrollTop", {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(900, value));
      },
    });

    return pane;
  };

  it.effect("scrolls a pane while the pointer holds near its bottom edge", () =>
    Effect.gen(function* () {
      const app = yield* mounted();
      const pane = scrollablePane(app);

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 95);
      yield* tick;
      assert.isAbove(pane.scrollTop, 0);
      pointer(document, "pointerup", 10, 95);
      yield* tick;

      const stopped = pane.scrollTop;

      yield* tick;
      assert.strictEqual(pane.scrollTop, stopped);
    }).pipe(Effect.scoped),
  );

  it.effect("a row scrolled out of its pane does not take a drop there", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ autoScroll: false });

      scrollablePane(app);
      // Row c spans 80 to 120; the pane shows 0 to 100, so 110 is outside it.
      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 110);
      pointer(document, "pointerup", 10, 110);
      yield* tick;
      assert.deepStrictEqual(logOf(app), ["put back a"]);
    }).pipe(Effect.scoped),
  );

  it.effect("does not scroll with autoScroll off", () =>
    Effect.gen(function* () {
      const app = yield* mounted({ autoScroll: false });
      const pane = scrollablePane(app);

      pointer(app.querySelector(".row-a")!, "pointerdown", 10, 10);
      pointer(document, "pointermove", 10, 95);
      yield* tick;
      assert.strictEqual(pane.scrollTop, 0);
      pointer(document, "pointerup", 10, 95);
    }).pipe(Effect.scoped),
  );
});
