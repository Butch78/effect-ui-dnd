// A sortable list in a scrolling pane, and a bin, to try DragArea by mouse,
// touch and keyboard: `pnpm example` serves it, `pnpm example:build` builds it.
// Rows drag by their grip, move themselves, target the nearest row in the
// gaps, and scroll the pane near its edges. "Plan the quarter" is locked.
import { UiSchema } from "@effect/ui";
import { BrowserHost, Html } from "@effect/ui/html";
import { Effect, Layer, Schema } from "effect";
import { DragArea, reorder } from "../src/index.ts";

const Task = Schema.Struct({ id: Schema.String, title: Schema.String });
interface Task extends Schema.Schema.Type<typeof Task> {}

const tasks: ReadonlyArray<Task> = [
  "Plan the quarter",
  "Write the brief",
  "Review the draft",
  "Publish the post",
  "Measure the results",
  "Answer the comments",
  "Update the calendar",
  "Brief the designer",
  "Check the analytics",
  "Archive old posts",
  "Send the newsletter",
  "Book the photo shoot",
].map((title) => ({ id: title.toLowerCase().replaceAll(" ", "-"), title }));

const keyOf = (id: string) => `NW-${101 + tasks.findIndex((task) => task.id === id)}`;

const locked = "plan-the-quarter";

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
        collision: "closest",
        follow: "item",
      },
      onEmit: (event) =>
        event._tag === "Dropped"
          ? Message.DroppedTask({ item: event.item, zone: event.zone, placement: event.placement })
          : Message.PutBackTask(),
      view: (dragArea) =>
        dragArea.root(h.main.class("list")).children(
          h.div
            .class("section-head")
            .children(h.h1.children("Backlog"), h.span.class("count").children(String(model.order.length))),
          h.div.class("pane").children(
            h.ul.class("tasks").children(
              model.order.map((id) =>
                dragArea
                  .zone(
                    dragArea.item(h.li.key(id), id, { handle: true, disabled: id === locked }),
                    id,
                    "vertical",
                  )
                  .class("task")
                  .children(
                    dragArea
                      .handle(h.span.class("grip"), id)
                      .attr("aria-label", `Move ${titleOf(id)}`)
                      .children("⠿"),
                    h.span.class("key").children(keyOf(id)),
                    h.span.class("title").children(titleOf(id)),
                  ),
              ),
            ),
          ),
          dragArea.zone(h.section.class("bin"), "bin").children(`Archive · ${model.binned.length}`),
          dragArea.announcer(h.div),
          dragArea.instructions(h.div),
        ),
    });
  },
});

const root = document.getElementById("root");

if (root !== null) Layer.launch(BrowserHost.mount(Board, {}, root)).pipe(Effect.runFork);
