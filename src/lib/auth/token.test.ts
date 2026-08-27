import { describe, expect, it } from "vitest";

import { signSession, verifySession } from "./token.ts";

const secret = "test-secret-that-is-at-least-32-chars";

describe("session tokens", () => {
  it("round-trips a session", async () => {
    const token = await signSession(
      { userId: "user-1", email: "reader@example.com" },
      secret,
    );
    await expect(verifySession(token, secret)).resolves.toEqual({
      userId: "user-1",
      email: "reader@example.com",
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(
      { userId: "user-1", email: "reader@example.com" },
      secret,
    );
    await expect(
      verifySession(token, "other-secret-that-is-at-least-32-chars"),
    ).resolves.toBeNull();
  });

  it("rejects garbage", async () => {
    await expect(verifySession("not.a.jwt", secret)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession(
      { userId: "user-1", email: "reader@example.com" },
      secret,
      0,
    );
    await expect(verifySession(token, secret)).resolves.toBeNull();
  });
});
