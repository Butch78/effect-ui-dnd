// The example's look and motion: the font, the styles, and cards and rows
// that glide to their new place after a drop instead of jumping. The motion
// is a plain FLIP animation outside the library: it remembers where each
// item was and, when the DOM changes, slides it from there to where it is.
import "@fontsource-variable/inter";
import "./styles.css";

const ITEM = "[data-dnd-item]";
const places = new Map<string, DOMRect>();
// The item a drag just let go of: it already sits under the pointer.
let released: string | null = null;

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
    const before = id === null ? undefined : places.get(id);

    if (id === null || before === undefined || id === released || element.style.transform !== "")
      continue;

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
  released = null;
  remember();
};

// Items added, removed or moved: glide them. A row that followed the pointer
// is skipped, and so is every move a scroll caused.
new MutationObserver(glide).observe(document.body, { childList: true, subtree: true });
document.addEventListener("scroll", remember, { capture: true, passive: true });
document.addEventListener(
  "pointerup",
  () => {
    released = document.querySelector<HTMLElement>(`${ITEM}[data-dragging]`)?.style.transform
      ? (document.querySelector(`${ITEM}[data-dragging]`)?.getAttribute("data-dnd-item") ?? null)
      : null;
  },
  { capture: true },
);
requestAnimationFrame(remember);
