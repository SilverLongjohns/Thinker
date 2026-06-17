import { describe, it, expect } from "vitest";
import { detectProjectId, detectFeature, stripBranchPrefix } from "../src/project.js";

describe("stripBranchPrefix", () => {
  it("strips feature/ prefix", () => {
    expect(stripBranchPrefix("feature/auth-refactor")).toBe("auth-refactor");
  });

  it("strips bugfix/ prefix", () => {
    expect(stripBranchPrefix("bugfix/login-crash")).toBe("login-crash");
  });

  it("strips fix/ prefix", () => {
    expect(stripBranchPrefix("fix/typo")).toBe("typo");
  });

  it("strips chore/ prefix", () => {
    expect(stripBranchPrefix("chore/deps")).toBe("deps");
  });

  it("leaves other branches unchanged", () => {
    expect(stripBranchPrefix("my-feature")).toBe("my-feature");
  });
});

describe("detectFeature", () => {
  it("returns null for main", () => {
    expect(detectFeature("main")).toBeNull();
  });

  it("returns null for master", () => {
    expect(detectFeature("master")).toBeNull();
  });

  it("returns null for develop", () => {
    expect(detectFeature("develop")).toBeNull();
  });

  it("returns stripped branch name for feature branches", () => {
    expect(detectFeature("feature/auth-refactor")).toBe("auth-refactor");
  });

  it("returns branch name for unprefixed branches", () => {
    expect(detectFeature("my-branch")).toBe("my-branch");
  });
});

describe("detectProjectId", () => {
  it("returns a stable hash string", () => {
    const id = detectProjectId("/some/repo/path");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns the same id for the same path", () => {
    const id1 = detectProjectId("/some/repo/path");
    const id2 = detectProjectId("/some/repo/path");
    expect(id1).toBe(id2);
  });

  it("returns different ids for different paths", () => {
    const id1 = detectProjectId("/path/a");
    const id2 = detectProjectId("/path/b");
    expect(id1).not.toBe(id2);
  });
});
