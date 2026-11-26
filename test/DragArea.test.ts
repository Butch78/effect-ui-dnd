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

const Page = Html.component({
  name: "Page",
  props: Schema.Struct({ pressDelay: Schema.optional(Schema.Finite) }),
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
        },
        onEmit: (event) =>
          event._tag === "Dropped"
            ? Message.Dropped({ item: event.item, zone: event.zone, placement: event.placement })
            : Message.PutBack({ item: event.item }),
        view: (dragArea) =>
          dragArea.root(h.div.class("area")).children(
            h.ul.children(
              model.order.map((id) =>
                dragArea
                  .zone(dragArea.item(h.li.key(id), id), id, "vertical")
                  .class(`row row-${id}`)
                  .children(id),
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
    const index = ["a", "b", "c"].indexOf(row.textContent ?? "");

    row.getBoundingClientRect = rect(0, index * 40, 200, 40);
  });

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
  Array.from(app.querySelectorAll(".row")).map((row) => row.textContent);
const logOf = (app: HTMLElement) =>
  Array.from(app.querySelectorAll(".log li")).map((line) => line.textContent);
const textOf = (app: HTMLElement, selector: string) =>
  app.querySelector(selector)?.textContent ?? null;

const mounted = (props: { readonly pressDelay?: number } = {}) =>
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
