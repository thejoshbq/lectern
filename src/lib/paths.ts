import { join } from "node:path";

/**
 * Canonical locations for everything read off disk.
 *
 * Each path is spelled out as a literal join from `process.cwd()` rather than
 * built through a helper. Every entry point — the Next server, `tsx` scripts,
 * and vitest — starts at the repository root through an npm script, and
 * keeping the segments literal is what lets the bundler trace exactly these
 * files into the server output instead of the entire project. Routing them
 * through a variadic helper hides the folder names from that analysis.
 */
/** Cached upstream release archives. Gitignored; rebuildable. */
export const VENDOR_DIR = join(process.cwd(), "vendor");

/** Extracted USJ source files, one per book. */
export const USJ_DIR = join(process.cwd(), "vendor", "usj");

/** Records which upstream release the local corpus was built from. */
export const VENDOR_MANIFEST = join(process.cwd(), "vendor", "manifest.json");

/** Generated artifacts. Gitignored; rebuildable via `npm run bible:all`. */
export const DATA_DIR = join(process.cwd(), "data");

/** The corpus: verses, passages, the FTS index, and passage vectors. */
export const CORPUS_DB = join(process.cwd(), "data", "bsb.sqlite");

/** Doctrinal source documents compiled into the system prompt. */
export const DOCS_DIR = join(process.cwd(), "docs");
