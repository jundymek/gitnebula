// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { renderModeToggle } from "./mode-toggle.js";

function mount(onMode = vi.fn()) {
  const handle = renderModeToggle({ onMode });
  document.body.replaceChildren(handle.element);
  const button = (id: string) =>
    handle.element.querySelector<HTMLButtonElement>(`#${id}`)!;
  return { handle, onMode, button };
}

describe("mode toggle (AC-5)", () => {
  it("is a labelled group of the mockup's two controls", () => {
    const { handle, button } = mount();
    expect(handle.element.getAttribute("role")).toBe("group");
    expect(handle.element.getAttribute("aria-label")).toBe("View mode");
    expect(button("mode-structure").textContent).toBe("structure");
    expect(button("mode-heat").textContent).toBe("change heatmap");
  });

  it("starts on structure and says so through aria-pressed", () => {
    const { button } = mount();
    expect(button("mode-structure").getAttribute("aria-pressed")).toBe("true");
    expect(button("mode-heat").getAttribute("aria-pressed")).toBe("false");
  });

  it("asks for a mode instead of assuming it took effect", () => {
    // The engine is the single source of truth for the mode; the toggle
    // repaints from its `mode` event, not from its own click.
    const { onMode, button } = mount();
    button("mode-heat").click();
    expect(onMode).toHaveBeenCalledWith("heat");
    expect(button("mode-heat").getAttribute("aria-pressed")).toBe("false");
  });

  it("reflects the mode it is told about, both ways", () => {
    const { handle, button } = mount();

    handle.setMode("heat");
    expect(button("mode-heat").getAttribute("aria-pressed")).toBe("true");
    expect(button("mode-structure").getAttribute("aria-pressed")).toBe("false");

    handle.setMode("structure");
    expect(button("mode-heat").getAttribute("aria-pressed")).toBe("false");
    expect(button("mode-structure").getAttribute("aria-pressed")).toBe("true");
  });
});
