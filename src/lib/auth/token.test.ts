import { describe, expect, it } from "vitest";

import { signSession, verifySession } from "./token.ts";

const secret = "test-secret-that-is-at-least-32-chars";

describe("session tokens", () => {
  it("round-trips an unlocked session", async () => {
    const token = await signSession(secret);
    await expect(verifySession(token, secret)).resolves.toEqual({
      unlocked: true,
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(secret);
    await expect(
      verifySession(token, "other-secret-that-is-at-least-32-chars"),
    ).resolves.toBeNull();
  });

  it("rejects garbage", async () => {
    await expect(verifySession("not.a.jwt", secret)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession(secret, 0);
    await expect(verifySession(token, secret)).resolves.toBeNull();
  });

  it("rejects an old account token whose subject is a user id", async () => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ email: "reader@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    await expect(verifySession(token, secret)).resolves.toBeNull();
  });
});
