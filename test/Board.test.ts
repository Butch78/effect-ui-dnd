// @vitest-environment happy-dom
import { UiSchema } from "@effect/ui";
import { BrowserHost, Html } from "@effect/ui/html";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { DragArea, moveBetween } from "../src/index.ts";

const tick = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));

const container = Effect.acquireRelease(
  Effect.sync(() => document.body.appendChild(document.createElement("div"))),
  (element) => Effect.sync(() => element.remove()),
);

const Columns = Schema.Struct({
  todo: Schema.Array(Schema.String),
  done: Schema.Array(Schema.String),
});

const Message = UiSchema.TaggedEnum({
  Dropped: {
    item: Schema.String,
    zone: Schema.String,
    placement: Schema.Literals(["before", "after", "inside"]),
  },
  PutBack: { item: Schema.String },
});

// Two columns: "todo" holding cards a and b, and an empty "done".
const Board = Html.component({
  name: "Board",
  model: Schema.Struct({ columns: Columns }),
  message: Message,
}).make({
  init: () => ({ columns: { todo: ["a", "b"], done: [] } }),
  update: {
    Dropped: ($, drop) => $.evolve({ columns: (columns) => moveBetween(columns, drop) }),
    PutBack: ($) => $.model,
  },
  view: (h, model) =>
    DragArea(h, {
      props: { labels: { a: "Alpha", b: "Beta", todo: "To do", done: "Done" } },
      onEmit: (event) =>
        event._tag === "Dropped" ? Message.Dropped(event) : Message.PutBack(event),
      view: (dragArea) =>
        dragArea
          .root(h.div.class("board"))
          .children(
            dragArea.announcer(h.div),
            ...(["todo", "done"] as const).map((column) =>
              dragArea
                .zone(h.section.key(column).class(`column column-${column}`), column)
                .children(
                  ...model.columns[column].map((id) =>
                    dragArea
                      .zone(
                        dragArea.item(h.article.key(id).class(`card card-${id}`), id),
                        id,
                        "vertical",
                      )
                      .children(id),
                  ),
                ),
            ),
          ),
    }),
});

const rect = (left: number, top: number, width: number, height: number) => () =>
  DOMRect.fromRect({ x: left, y: top, width, height });

// Columns 200 px wide side by side, 300 px tall; cards 40 px tall with a
// 10 px gap, from 10 px down.
const layOut = (app: HTMLElement) => {
  for (const [index, column] of ["todo", "done"].entries()) {
    const element = app.querySelector<HTMLElement>(`.column-${column}`);

    if (element === null) continue;
    element.getBoundingClientRect = rect(index * 220, 0, 200, 300);
    element.querySelectorAll<HTMLElement>(".card").forEach((card, row) => {
      card.getBoundingClientRect = rect(index * 220 + 10, 10 + row * 50, 180, 40);
    });
  }
};

const pointer = (target: EventTarget, type: string, x: number, y: number) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    }),
  );

const drag = (from: Element, x: number, y: number, toX: number, toY: number) => {
  pointer(from, "pointerdown", x, y);
  pointer(document, "pointermove", toX, toY);
  pointer(document, "pointerup", toX, toY);
};

const key = (target: EventTarget, name: string) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );

const cardsIn = (app: HTMLElement, column: string) =>
  Array.from(app.querySelectorAll(`.column-${column} .card`)).map((card) =>
    card.getAttribute("data-dnd-item"),
  );

const mounted = Effect.gen(function* () {
  const app = yield* container;

  yield* BrowserHost.mountEffect(Board, {}, app);
  yield* tick;
  layOut(app);

  return app;
});

describe("DragArea on a board", () => {
  it.effect("a card dropped in an empty column moves into it", () =>
    Effect.gen(function* () {
      const app = yield* mounted;

      drag(app.querySelector(".card-a")!, 20, 20, 300, 200);
      yield* tick;
      assert.deepStrictEqual(cardsIn(app, "todo"), ["b"]);
      assert.deepStrictEqual(cardsIn(app, "done"), ["a"]);
    }).pipe(Effect.scoped),
  );

  it.effect("a card dropped on a card in another column lands next to it", () =>
    Effect.gen(function* () {
      const app = yield* mounted;

      drag(app.querySelector(".card-a")!, 20, 20, 300, 200);
      yield* tick;
      layOut(app);
      // b over the top half of a, now first in "done".
      drag(app.querySelector(".card-b")!, 20, 20, 300, 15);
      yield* tick;
      assert.deepStrictEqual(cardsIn(app, "todo"), []);
      assert.deepStrictEqual(cardsIn(app, "done"), ["b", "a"]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "the gap between two cards, and the space under them, place the card next to the nearest one",
    () =>
      Effect.gen(function* () {
        const app = yield* mounted;

        // Over the column below both cards: after b, not inside the column.
        pointer(app.querySelector(".card-a")!, "pointerdown", 20, 20);
        pointer(document, "pointermove", 100, 250);
        yield* tick;
        assert.strictEqual(app.querySelector(".card-b")?.getAttribute("data-placement"), "after");
        assert.isFalse(app.querySelector(".column-todo")?.hasAttribute("data-over"));
        pointer(document, "pointerup", 100, 250);
        yield* tick;
        assert.deepStrictEqual(cardsIn(app, "todo"), ["b", "a"]);
      }).pipe(Effect.scoped),
  );

  it.effect("the keyboard steps from a card into the next column", () =>
    Effect.gen(function* () {
      const app = yield* mounted;
      const cardA = app.querySelector<HTMLElement>(".card-a")!;

      key(cardA, " ");
      // Stops in order: todo, a, b, done.
      key(cardA, "ArrowDown");
      key(cardA, "ArrowDown");
      yield* tick;
      assert.strictEqual(app.querySelector("[role=status]")?.textContent, "Alpha is over Done.");
      key(cardA, " ");
      yield* tick;
      assert.deepStrictEqual(cardsIn(app, "done"), ["a"]);
    }).pipe(Effect.scoped),
  );
});
