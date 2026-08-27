import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const CLIENT_FILES = [
  "src/components/Chat.tsx",
  "src/components/Scripture.tsx",
  "src/lib/client/storage.ts",
  "src/lib/client/stream.ts",
  "src/lib/agent/wire.ts",
] as const;

const SERVER_MODULES = [
  "agent/pipeline",
  "agent/serialize",
  "agent/prompts",
  "agent/client",
  "bible/corpus",
  "bible/verify",
] as const;

describe("client import graph", () => {
  it("does not import server modules from client files or the wire types leaf", () => {
    const pattern = new RegExp(
      `from ["'][^"']*(${SERVER_MODULES.join("|")})`,
    );

    for (const relative of CLIENT_FILES) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(pattern);
    }
  });

  it("keeps wire.ts free of any local imports", () => {
    const source = readFileSync(join(root, "src/lib/agent/wire.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
