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
    expect(button("2d").getAttribute("aria-checked")).toBe("true");
    expect(button("3d").getAttribute("aria-checked")).toBe("false");
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
    expect(button("2d").getAttribute("aria-checked")).toBe("true");
    expect(button("3d").getAttribute("aria-checked")).toBe("false");
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
  });

  it("does not report a click on the disabled 3D button", () => {
    const onChange = vi.fn();
    const { handle, button } = mount({ onChange });
    handle.setUnavailable("no");
    button("3d").click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-enables 3D when the reason is cleared", () => {
    const { handle, button } = mount({ onChange: () => {} });
    handle.setUnavailable("no");
    handle.setUnavailable(null);
    expect(button("3d").disabled).toBe(false);
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

describe("accessibility", () => {
  it("is a labelled radio group of two radios", () => {
    const { handle, button } = mount({ onChange: () => {} });
    expect(handle.element.getAttribute("role")).toBe("radiogroup");
    expect(handle.element.getAttribute("aria-label")).toBeTruthy();
    expect(button("2d").getAttribute("role")).toBe("radio");
    expect(button("3d").getAttribute("role")).toBe("radio");
  });

  it("keeps only the selected view in the tab order", () => {
    const { handle, button } = mount({ onChange: () => {} });
    expect(button("2d").tabIndex).toBe(0);
    expect(button("3d").tabIndex).toBe(-1);
    handle.setCurrent("3d");
    expect(button("3d").tabIndex).toBe(0);
    expect(button("2d").tabIndex).toBe(-1);
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

  it("moves between views with the arrow keys", () => {
    const onChange = vi.fn();
    const { handle } = mount({ onChange });
    handle.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(onChange).toHaveBeenCalledWith("3d");
  });

  it("does not arrow onto a disabled 3D view", () => {
    const onChange = vi.fn();
    const { handle } = mount({ onChange });
    handle.setUnavailable("no");
    handle.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
