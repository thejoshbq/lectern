import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.ts";

describe("password hashing", () => {
  it("verifies a hash of the same password", async () => {
    const hash = await hashPassword("a-reasonably-long-password");
    expect(hash.startsWith("scrypt$")).toBe(true);
    await expect(
      verifyPassword("a-reasonably-long-password", hash),
    ).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("a-reasonably-long-password");
    await expect(verifyPassword("a-different-password", hash)).resolves.toBe(
      false,
    );
  });

  it("rejects a malformed stored hash without throwing", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$nope")).resolves.toBe(
      false,
    );
  });
});
