import { afterEach, describe, expect, it } from "vitest";

import { unlock } from "./unlock.ts";

describe("unlock", () => {
  afterEach(() => {
    delete process.env.LECTERN_PASSWORD;
  });

  it("accepts the configured password", () => {
    process.env.LECTERN_PASSWORD = "the-shared-password";
    expect(unlock("the-shared-password")).toBe(true);
  });

  it("rejects a miss, including a prefix of the real password", () => {
    process.env.LECTERN_PASSWORD = "the-shared-password";
    expect(unlock("the-shared")).toBe(false);
    expect(unlock("the-shared-password-extra")).toBe(false);
    expect(unlock("")).toBe(false);
  });

  it("fails closed when the site password is not configured", () => {
    delete process.env.LECTERN_PASSWORD;
    expect(() => unlock("anything")).toThrow(/LECTERN_PASSWORD/);
  });

  it("fails closed when the site password is blank", () => {
    process.env.LECTERN_PASSWORD = "   ";
    expect(() => unlock("anything")).toThrow(/LECTERN_PASSWORD/);
  });
});
