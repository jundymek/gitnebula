// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderViewSwitch,
  VIEW_SWITCH_REASON_ID,
  type ViewSwitchKind,
} from "./view-switch.js";

function mount(options: Parameters<typeof renderViewSwitch>[0]) {
  const handle = renderViewSwitch(options);
  document.body.append(handle.element);
  const button = (view: ViewSwitchKind): HTMLButtonElement =>
    handle.element.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)!;
  return { handle, button };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the 2D/3D switch", () => {
  it("starts on 2D — the default view (AC-1)", () => {
    const { handle, button } = mount({ onChange: () => {} });
    expect(handle.getCurrent()).toBe("2d");
    expect(button("2d").getAttribute("aria-pressed")).toBe("true");
    expect(button("3d").getAttribute("aria-pressed")).toBe("false");
  });

  it("reports a change to the other view", () => {
    const onChange = vi.fn();
    const { button } = mount({ onChange });
    button("3d").click();
    expect(onChange).toHaveBeenCalledWith("3d");
  });

  it("does not report re-clicking the view already shown", () => {
    // Rebuilding the engine would re-run the settle and throw away the
    // reader's camera — a click that changes nothing must cost nothing.
    const onChange = vi.fn();
    const { button } = mount({ current: "2d", onChange });
    button("2d").click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reflects the view actually built, not the one requested", () => {
    // A 3D request that fell back to 2D must not leave "3D" looking selected.
    const { handle, button } = mount({ current: "3d", onChange: () => {} });
    handle.setCurrent("2d");
    expect(button("2d").getAttribute("aria-pressed")).toBe("true");
    expect(button("3d").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("AC-5 — an unavailable 3D view states its reason", () => {
  it("disables 3D and shows the reason rather than hiding the control", () => {
    const { handle, button } = mount({ onChange: () => {} });
    handle.setUnavailable("Canvas is blocked by a privacy setting.");

    expect(button("3d").disabled).toBe(true);
    expect(button("3d").getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(VIEW_SWITCH_REASON_ID)!.textContent,
    ).toContain("privacy setting");
    // The reason is also on the control the reader is pointing at.
    expect(button("3d").title).toContain("privacy setting");
  });

  it("does not report a click on the disabled 3D button", () => {
    const onChange = vi.fn();
    const { handle, button } = mount({ onChange });
    handle.setUnavailable("no");
    button("3d").click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-enables 3D and restores its title when the reason is cleared", () => {
    const { handle, button } = mount({ onChange: () => {} });
    const originalTitle = button("3d").title;
    handle.setUnavailable("no");
    handle.setUnavailable(null);
    expect(button("3d").disabled).toBe(false);
    expect(button("3d").title).toBe(originalTitle);
    expect(document.getElementById(VIEW_SWITCH_REASON_ID)!.textContent).toBe(
      "",
    );
  });

  it("accepts the reason at construction", () => {
    const { button } = mount({
      unavailableReason: "3D needs a rendering context.",
      onChange: () => {},
    });
    expect(button("3d").disabled).toBe(true);
  });
});

describe("accessibility and styling hooks", () => {
  it("is a labelled group of two toggle buttons", () => {
    const { handle, button } = mount({ onChange: () => {} });
    expect(handle.element.getAttribute("role")).toBe("group");
    expect(handle.element.getAttribute("aria-label")).toBeTruthy();
    expect(button("2d").type).toBe("button");
    expect(button("3d").type).toBe("button");
  });

  it("carries the shared segmented-control class, so the pressed view is visible", () => {
    // `.modes button[aria-pressed="true"]` in styles.css is what makes the
    // selected view legible to a sighted reader. Without this class the state
    // would live only in ARIA — correct for a screen reader and invisible to
    // everyone else. Asserted because it is a real dependency, not decoration.
    const { handle } = mount({ onChange: () => {} });
    expect(handle.element.classList.contains("modes")).toBe(true);
  });

  it("points the 3D button at the element carrying its reason", () => {
    // The reason element exists even when empty, so the reference is never
    // dangling — a describedby pointing at nothing is announced as nothing.
    const { button } = mount({ onChange: () => {} });
    expect(button("3d").getAttribute("aria-describedby")).toBe(
      VIEW_SWITCH_REASON_ID,
    );
    expect(document.getElementById(VIEW_SWITCH_REASON_ID)).not.toBeNull();
  });
});
