import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Bible corpus is a SQLite file read from disk at request time. Bundling
  // would both bloat the output and break the read-only file handle.
  serverExternalPackages: ["node:sqlite", "postgres"],
  // Read at runtime by the API route: the corpus every citation resolves
  // against, and the doctrinal documents compiled into the system prompt.
  outputFileTracingIncludes: {
    "/api/**": ["./data/bsb.sqlite", "./docs/*.md"],
  },
  // Next regenerates AGENTS.md and CLAUDE.md on every build. The guidance this
  // project actually depends on lives in docs/, and having the framework
  // rewrite root-level instruction files is noise.
  agentRules: false,
};

export default nextConfig;
