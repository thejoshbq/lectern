import { describe, expect, it } from "vitest";

import { secretsEqual } from "./secret.ts";

describe("secretsEqual", () => {
  it("accepts an exact match", () => {
    expect(secretsEqual("invite-code", "invite-code")).toBe(true);
  });

  it("rejects a miss, including a prefix of the real secret", () => {
    expect(secretsEqual("invite", "invite-code")).toBe(false);
    expect(secretsEqual("invite-code", "invite-code-extra")).toBe(false);
    expect(secretsEqual("", "invite-code")).toBe(false);
  });

  it("never accepts an empty expected secret", () => {
    expect(secretsEqual("", "")).toBe(false);
    expect(secretsEqual("anything", "")).toBe(false);
  });
});
