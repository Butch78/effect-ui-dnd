// The example's look and motion: the font, the styles, and cards and rows
// that glide to their new place after a drop instead of jumping. The motion
// is a plain FLIP animation outside the library: it remembers where each
// item was and, when the DOM changes, slides it from there to where it is.
import "@fontsource-variable/inter";
import "./styles.css";

const ITEM = "[data-dnd-item]";
const places = new Map<string, DOMRect>();
// The item a pointer just let go of, and where it was on screen at that
// moment: under the pointer, as the preview or as the item itself. It glides
// from there, not from the place it was picked up.
let dropped: { readonly id: string; readonly from: DOMRect } | null = null;

const remember = () => {
  places.clear();
  for (const element of document.querySelectorAll<HTMLElement>(ITEM)) {
    const id = element.getAttribute("data-dnd-item");

    if (id !== null && element.style.transform === "")
      places.set(id, element.getBoundingClientRect());
  }
};

const glide = () => {
  for (const element of document.querySelectorAll<HTMLElement>(ITEM)) {
    const id = element.getAttribute("data-dnd-item");
    const before = id === null ? undefined : id === dropped?.id ? dropped.from : places.get(id);

    if (id === null || before === undefined || element.style.transform !== "") continue;

    const after = element.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      {
        duration: 260,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    );
  }
  dropped = null;
  remember();
};

// Items added, removed or moved: glide them. A scroll moves nothing.
new MutationObserver(glide).observe(document.body, { childList: true, subtree: true });
document.addEventListener("scroll", remember, { capture: true, passive: true });
document.addEventListener(
  "pointerup",
  () => {
    const held = document.querySelector<HTMLElement>(`${ITEM}[data-dragging]`);
    const id = held?.getAttribute("data-dnd-item");
    const preview = document.querySelector<HTMLElement>(".preview");

    dropped =
      held === null || id === null || id === undefined
        ? null
        : { id, from: (preview ?? held).getBoundingClientRect() };
  },
  { capture: true },
);
requestAnimationFrame(remember);
