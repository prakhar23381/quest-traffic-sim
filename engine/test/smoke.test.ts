import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "../src/index";

describe("engine scaffold", () => {
  it("exports a version", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
