import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./users.ts", () => ({
  findUserByEmail: vi.fn(),
  insertUser: vi.fn(),
}));

import { authenticateAccount, registerAccount } from "./accounts.ts";
import { hashPassword } from "./password.ts";
import { findUserByEmail, insertUser } from "./users.ts";

const findUser = vi.mocked(findUserByEmail);
const insert = vi.mocked(insertUser);

describe("registerAccount", () => {
  beforeEach(() => {
    findUser.mockReset();
    insert.mockReset();
    process.env.LECTERN_ADMIN_CODE = "the-invite";
  });

  it("refuses registration without a valid invite code", async () => {
    findUser.mockResolvedValue(null);
    const result = await registerAccount({
      email: "reader@example.com",
      password: "long-enough-password",
      adminCode: "wrong",
    });
    expect(result).toEqual({
      ok: false,
      error: "That invite code is not valid.",
      status: 403,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses registration when no invite code is configured", async () => {
    delete process.env.LECTERN_ADMIN_CODE;
    findUser.mockResolvedValue(null);
    const result = await registerAccount({
      email: "reader@example.com",
      password: "long-enough-password",
      adminCode: "the-invite",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates an account when the invite code matches", async () => {
    findUser.mockResolvedValue(null);
    insert.mockResolvedValue("ok");
    const result = await registerAccount({
      email: "Reader@Example.com",
      password: "long-enough-password",
      adminCode: "the-invite",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.email).toBe("reader@example.com");
    expect(insert).toHaveBeenCalledOnce();
  });

  it("does not create a second account for the same email", async () => {
    findUser.mockResolvedValue({
      id: "existing",
      email: "reader@example.com",
      passwordHash: "scrypt$x",
    });
    const result = await registerAccount({
      email: "reader@example.com",
      password: "long-enough-password",
      adminCode: "the-invite",
    });
    expect(result).toEqual({
      ok: false,
      error: "An account with that email already exists.",
      status: 409,
    });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("authenticateAccount", () => {
  beforeEach(() => {
    findUser.mockReset();
    insert.mockReset();
  });

  it("rejects an unknown email without distinguishing it", async () => {
    findUser.mockResolvedValue(null);
    const result = await authenticateAccount({
      email: "nobody@example.com",
      password: "long-enough-password",
    });
    expect(result).toEqual({
      ok: false,
      error: "Email or password is wrong.",
      status: 401,
    });
  });

  it("accepts the right password", async () => {
    const passwordHash = await hashPassword("long-enough-password");
    findUser.mockResolvedValue({
      id: "user-1",
      email: "reader@example.com",
      passwordHash,
    });
    const result = await authenticateAccount({
      email: "reader@example.com",
      password: "long-enough-password",
    });
    expect(result).toEqual({
      ok: true,
      user: { id: "user-1", email: "reader@example.com" },
    });
  });
});
