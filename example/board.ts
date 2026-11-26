// A board of three columns: cards move between them and within them, by
// mouse, touch and keyboard. A floating preview follows the pointer.
import { UiSchema } from "@effect/ui";
import { BrowserHost, Html } from "@effect/ui/html";
import { Effect, Layer, Schema } from "effect";
import { DragArea, moveBetween } from "../src/index.ts";

const Card = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  title: Schema.String,
  label: Schema.String,
  priority: Schema.Finite,
  owner: Schema.String,
  colour: Schema.String,
});
interface Card extends Schema.Schema.Type<typeof Card> {}

const cards: ReadonlyArray<Card> = [
  { id: "hero", key: "NW-214", title: "Hero image for the launch", label: "Design", priority: 3, owner: "AK", colour: "#f9a8d4" },
  { id: "copy", key: "NW-215", title: "Landing page copy", label: "Writing", priority: 2, owner: "MB", colour: "#93c5fd" },
  { id: "pricing", key: "NW-218", title: "Pricing table", label: "Web", priority: 1, owner: "JS", colour: "#86efac" },
  { id: "press", key: "NW-221", title: "Press release", label: "Writing", priority: 2, owner: "MB", colour: "#93c5fd" },
  { id: "video", key: "NW-223", title: "Product video", label: "Design", priority: 3, owner: "AK", colour: "#f9a8d4" },
];

const columns = [
  { id: "todo", title: "Todo" },
  { id: "doing", title: "In Progress" },
  { id: "done", title: "Done" },
] as const;

const Columns = Schema.Struct({
  todo: Schema.Array(Schema.String),
  doing: Schema.Array(Schema.String),
  done: Schema.Array(Schema.String),
});

const Message = UiSchema.TaggedEnum({
  DroppedCard: {
    item: Schema.String,
    zone: Schema.String,
    placement: Schema.Literals(["before", "after", "inside"]),
  },
  PutBackCard: {},
});

const Board = Html.component({
  name: "Board",
  model: Schema.Struct({ columns: Columns }),
  message: Message,
}).make({
  init: () => ({
    columns: { todo: ["hero", "copy", "pricing"], doing: ["press", "video"], done: [] },
  }),
  update: {
    DroppedCard: ($, drop) => $.evolve({ columns: (current) => moveBetween(current, drop) }),
    PutBackCard: ($) => $.model,
  },
  view: (h, model) => {
    const cardOf = (id: string) => cards.find((card) => card.id === id);
    const labels = Object.fromEntries([
      ...cards.map((card) => [card.id, card.title]),
      ...columns.map((column) => [column.id, column.title]),
    ]);
    const face = (card: Card | undefined) => [
      h.div.class("card-top").children(card?.key ?? ""),
      h.p.class("card-title").children(card?.title ?? ""),
      h.div
        .class("card-meta")
        .children(
          h.span.class(`priority priority-${card?.priority ?? 0}`).children(h.i, h.i, h.i),
          h.span.class(`label label-${(card?.label ?? "").toLowerCase()}`).children(card?.label ?? ""),
          h.span
            .class("avatar")
            .attr("style", `background:${card?.colour ?? "#999"}`)
            .children(card?.owner ?? ""),
        ),
    ];

    return DragArea(h, {
      props: { labels },
      onEmit: (event) =>
        event._tag === "Dropped" ? Message.DroppedCard(event) : Message.PutBackCard(),
      view: (dragArea) =>
        dragArea.root(h.div.class("board")).children(
          ...columns.map((column) => {
            const ids = model.columns[column.id];

            return dragArea
              .zone(h.section.key(column.id).class("column"), column.id)
              .children(
                h.div
                  .class("section-head")
                  .children(
                    h.span.class(`status status-${column.id}`),
                    h.h2.children(column.title),
                    h.span.class("count").children(String(ids.length)),
                  ),
                ids.length === 0 ? h.p.class("empty").children("Drop issues here") : h.span,
                ...ids.map((id) =>
                  dragArea
                    .zone(dragArea.item(h.article.key(id).class("card"), id), id, "vertical")
                    .children(...face(cardOf(id))),
                ),
              );
          }),
          dragArea.via === "pointer" && dragArea.dragging !== null
            ? dragArea
                .preview(h.article.class("card preview"))
                .children(...face(cardOf(dragArea.dragging)))
            : h.span,
          dragArea.announcer(h.div),
          dragArea.instructions(h.div),
        ),
    });
  },
});

const root = document.getElementById("board");

if (root !== null) Layer.launch(BrowserHost.mount(Board, {}, root)).pipe(Effect.runFork);
