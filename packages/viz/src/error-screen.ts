/**
 * FR-6's refusal screen.
 *
 * Built with `textContent` rather than `innerHTML`: the strings it shows come
 * from a file the viewer has just decided it cannot trust, and a version
 * string is not a place to start interpreting markup.
 */

import type { LoadFailure } from "./loader.js";

export function renderErrorScreen(root: Element, failure: LoadFailure): void {
  root.replaceChildren();

  const screen = document.createElement("div");
  screen.className = "error-screen";
  screen.setAttribute("role", "alert");

  const heading = document.createElement("h1");
  heading.textContent = failure.title;
  screen.append(heading);

  const detail = document.createElement("p");
  detail.textContent = failure.detail;
  screen.append(detail);

  // A mismatch names BOTH versions, because "unsupported" without the numbers
  // tells the reader nothing they can act on (FR-6).
  if (failure.foundVersion && failure.supportedVersion) {
    const versions = document.createElement("div");
    versions.className = "versions";
    versions.append(
      labelled("document schemaVersion", failure.foundVersion),
      labelled("viewer supports major", failure.supportedVersion),
    );
    screen.append(versions);
  }

  root.append(screen);
}

function labelled(label: string, value: string): HTMLElement {
  const span = document.createElement("span");
  span.append(`${label} `);
  const strong = document.createElement("b");
  strong.textContent = value;
  span.append(strong);
  return span;
}
