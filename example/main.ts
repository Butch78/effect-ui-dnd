// A sortable list and a bin, to try DragArea by mouse, touch and keyboard:
// `pnpm example` serves it, `pnpm example:build` builds it.
import { UiSchema } from "@effect/ui";
import { BrowserHost, Html } from "@effect/ui/html";
import { Effect, Layer, Schema } from "effect";
import { DragArea, reorder } from "../src/index.ts";

const Task = Schema.Struct({ id: Schema.String, title: Schema.String });
interface Task extends Schema.Schema.Type<typeof Task> {}

const tasks: ReadonlyArray<Task> = [
  { id: "write", title: "Write the brief" },
  { id: "review", title: "Review the draft" },
  { id: "publish", title: "Publish the post" },
  { id: "measure", title: "Measure the results" },
];

const Message = UiSchema.TaggedEnum({
  DroppedTask: { item: Schema.String, zone: Schema.String, placement: Schema.String },
  PutBackTask: {},
});

const Board = Html.component({
  name: "Board",
  model: Schema.Struct({ order: Schema.Array(Schema.String), binned: Schema.Array(Schema.String) }),
  message: Message,
}).make({
  init: () => ({ order: tasks.map((task) => task.id), binned: [] }),
  update: {
    DroppedTask: ($, { item, zone, placement }) =>
      zone === "bin"
        ? $.set({
            order: $.model.order.filter((id) => id !== item),
            binned: [...$.model.binned, item],
          })
        : placement === "before" || placement === "after"
          ? $.evolve({ order: (order) => reorder(order, { item, zone, placement }) })
          : $.model,
    PutBackTask: ($) => $.model,
  },
  view: (h, model) => {
    const titleOf = (id: string) => tasks.find((task) => task.id === id)?.title ?? id;

    return DragArea(h, {
      props: {
        labels: Object.fromEntries([
          ...tasks.map((task) => [task.id, task.title]),
          ["bin", "the bin"],
        ]),
      },
      onEmit: (event) =>
        event._tag === "Dropped"
          ? Message.DroppedTask({ item: event.item, zone: event.zone, placement: event.placement })
          : Message.PutBackTask(),
      view: (dragArea) =>
        dragArea.root(h.main.class("board")).children(
          h.h1.children("Tasks"),
          h.ul.class("tasks").children(
            model.order.map((id) =>
              dragArea
                .zone(dragArea.item(h.li.key(id), id), id, "vertical")
                .class("task")
                .children(titleOf(id)),
            ),
          ),
          dragArea.zone(h.section.class("bin"), "bin").children(`Bin (${model.binned.length})`),
          dragArea.via === "pointer" && dragArea.dragging !== null
            ? dragArea.preview(h.div.class("task preview")).children(titleOf(dragArea.dragging))
            : h.span,
          dragArea.announcer(h.div),
          dragArea.instructions(h.div),
        ),
    });
  },
});

const root = document.getElementById("root");

if (root !== null) Layer.launch(BrowserHost.mount(Board, {}, root)).pipe(Effect.runFork);
