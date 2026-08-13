import { describe, expect, it } from "vitest";

import { createPythonResolver } from "./resolve.js";

const UNIVERSE = [
  "flat.py",
  "app/__init__.py",
  "app/service.py",
  "app/sub/__init__.py",
  "app/sub/deep.py",
  "lib/pkg/__init__.py",
  "lib/pkg/tools.py",
  "docs/readme.md",
  // Stubs: one with no module beside it, one shadowed by its own module, and
  // a package whose only marker is a stub.
  "app/typed.pyi",
  "app/service.pyi",
  "stubs/only/__init__.pyi",
];

const resolver = createPythonResolver(UNIVERSE);

describe("source roots", () => {
  it("is the repo root plus the parent of every top-level package", () => {
    // `app` is a package at the root; `lib/pkg` is a package under lib, so lib
    // is a source root and `lib.pkg` is *not* how the repo imports it.
    // `stubs` is one too: a package marked only by `__init__.pyi` is a package.
    expect(resolver.sourceRoots).toEqual(["", "lib", "stubs"]);
  });

  it("does not make a nested package its own root", () => {
    // app/sub is a package inside a package: `app.sub.deep`, never `sub.deep`.
    expect(resolver.resolveAbsolute(["sub", "deep"])).toBeUndefined();
    expect(resolver.resolveAbsolute(["app", "sub", "deep"])).toBe(
      "app/sub/deep.py",
    );
  });
});

describe("absolute resolution", () => {
  it("finds a module, a package and a root-level file", () => {
    expect(resolver.resolveAbsolute(["app", "service"])).toBe("app/service.py");
    expect(resolver.resolveAbsolute(["app"])).toBe("app/__init__.py");
    expect(resolver.resolveAbsolute(["flat"])).toBe("flat.py");
  });

  it("finds a module through a source root below the repo root", () => {
    expect(resolver.resolveAbsolute(["pkg", "tools"])).toBe("lib/pkg/tools.py");
  });

  it("returns nothing for a module the repo does not contain", () => {
    // This is what stdlib and site-packages look like from here (AC-3).
    expect(resolver.resolveAbsolute(["os", "path"])).toBeUndefined();
    expect(resolver.resolveAbsolute([])).toBeUndefined();
  });

  it("never resolves to a non-Python file", () => {
    expect(resolver.resolveAbsolute(["docs", "readme"])).toBeUndefined();
  });
});

describe("stub files", () => {
  it("resolves to a .pyi when nothing else answers the name", () => {
    expect(resolver.resolveAbsolute(["app", "typed"])).toBe("app/typed.pyi");
    expect(resolver.resolveRelative("app/service.py", 1, ["typed"])).toBe(
      "app/typed.pyi",
    );
  });

  it("prefers the module over a stub of the same name", () => {
    expect(resolver.resolveAbsolute(["app", "service"])).toBe("app/service.py");
  });

  it("treats a package marked only by __init__.pyi as a package", () => {
    expect(resolver.resolveAbsolute(["stubs", "only"])).toBe(
      "stubs/only/__init__.pyi",
    );
  });
});

describe("relative resolution", () => {
  it("takes one dot as the importing file's own package", () => {
    expect(resolver.resolveRelative("app/service.py", 1, ["sub"])).toBe(
      "app/sub/__init__.py",
    );
    expect(resolver.resolveRelative("app/sub/deep.py", 1, [])).toBe(
      "app/sub/__init__.py",
    );
  });

  it("climbs one directory per extra dot", () => {
    expect(resolver.resolveRelative("app/sub/deep.py", 2, ["service"])).toBe(
      "app/service.py",
    );
    expect(resolver.resolveRelative("app/sub/deep.py", 3, ["flat"])).toBe(
      "flat.py",
    );
  });

  it("returns nothing when the dots climb out of the repo", () => {
    expect(
      resolver.resolveRelative("app/service.py", 4, ["x"]),
    ).toBeUndefined();
  });

  it("returns nothing when no file answers the name", () => {
    expect(
      resolver.resolveRelative("app/service.py", 1, ["missing"]),
    ).toBeUndefined();
  });
});
