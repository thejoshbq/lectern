/**
 * The 66-book Protestant canon, in canonical order.
 *
 * Genre is carried here because it is load-bearing for interpretation, not
 * decoration: how a passage may legitimately be applied depends on whether it
 * is narrative, law, wisdom, prophecy, gospel, epistle, or apocalyptic. The
 * retrieval layer surfaces genre to the model so that, for example, a line of
 * Job's friends' counsel is not handed to a grieving user as divine promise.
 */

export type Testament = "OT" | "NT";

export type Genre =
  | "law"
  | "history"
  | "wisdom"
  | "psalm"
  | "poetry"
  | "prophecy"
  | "gospel"
  | "acts"
  | "epistle"
  | "apocalyptic";

export interface Book {
  /** USFM code, e.g. "GEN". Used as the stable identifier throughout. */
  code: string;
  /** Canonical position, 1-66. Drives ordering and range arithmetic. */
  order: number;
  name: string;
  testament: Testament;
  genre: Genre;
  chapters: number;
  /** Lowercased forms accepted when parsing a human-written reference. */
  aliases: string[];
}

export const BOOKS: readonly Book[] = [
  // Old Testament
  { code: "GEN", order: 1, name: "Genesis", testament: "OT", genre: "law", chapters: 50, aliases: ["gen", "ge", "gn"] },
  { code: "EXO", order: 2, name: "Exodus", testament: "OT", genre: "law", chapters: 40, aliases: ["exo", "ex", "exod"] },
  { code: "LEV", order: 3, name: "Leviticus", testament: "OT", genre: "law", chapters: 27, aliases: ["lev", "le", "lv"] },
  { code: "NUM", order: 4, name: "Numbers", testament: "OT", genre: "law", chapters: 36, aliases: ["num", "nu", "nm", "nb"] },
  { code: "DEU", order: 5, name: "Deuteronomy", testament: "OT", genre: "law", chapters: 34, aliases: ["deu", "dt", "deut"] },
  { code: "JOS", order: 6, name: "Joshua", testament: "OT", genre: "history", chapters: 24, aliases: ["jos", "josh", "jsh"] },
  { code: "JDG", order: 7, name: "Judges", testament: "OT", genre: "history", chapters: 21, aliases: ["jdg", "judg", "jg"] },
  { code: "RUT", order: 8, name: "Ruth", testament: "OT", genre: "history", chapters: 4, aliases: ["rut", "ru", "rth"] },
  { code: "1SA", order: 9, name: "1 Samuel", testament: "OT", genre: "history", chapters: 31, aliases: ["1sa", "1sam", "1 sam", "1 samuel"] },
  { code: "2SA", order: 10, name: "2 Samuel", testament: "OT", genre: "history", chapters: 24, aliases: ["2sa", "2sam", "2 sam", "2 samuel"] },
  { code: "1KI", order: 11, name: "1 Kings", testament: "OT", genre: "history", chapters: 22, aliases: ["1ki", "1kg", "1kgs", "1 kgs", "1 kings"] },
  { code: "2KI", order: 12, name: "2 Kings", testament: "OT", genre: "history", chapters: 25, aliases: ["2ki", "2kg", "2kgs", "2 kgs", "2 kings"] },
  { code: "1CH", order: 13, name: "1 Chronicles", testament: "OT", genre: "history", chapters: 29, aliases: ["1ch", "1chr", "1 chr", "1 chron", "1 chronicles"] },
  { code: "2CH", order: 14, name: "2 Chronicles", testament: "OT", genre: "history", chapters: 36, aliases: ["2ch", "2chr", "2 chr", "2 chron", "2 chronicles"] },
  { code: "EZR", order: 15, name: "Ezra", testament: "OT", genre: "history", chapters: 10, aliases: ["ezr"] },
  { code: "NEH", order: 16, name: "Nehemiah", testament: "OT", genre: "history", chapters: 13, aliases: ["neh", "ne"] },
  { code: "EST", order: 17, name: "Esther", testament: "OT", genre: "history", chapters: 10, aliases: ["est", "esth", "es"] },
  { code: "JOB", order: 18, name: "Job", testament: "OT", genre: "wisdom", chapters: 42, aliases: ["job", "jb"] },
  { code: "PSA", order: 19, name: "Psalms", testament: "OT", genre: "psalm", chapters: 150, aliases: ["psa", "ps", "psalm", "psalms", "pss", "psm"] },
  { code: "PRO", order: 20, name: "Proverbs", testament: "OT", genre: "wisdom", chapters: 31, aliases: ["pro", "prov", "pr", "prv"] },
  { code: "ECC", order: 21, name: "Ecclesiastes", testament: "OT", genre: "wisdom", chapters: 12, aliases: ["ecc", "eccl", "ec", "qoh"] },
  { code: "SNG", order: 22, name: "Song of Solomon", testament: "OT", genre: "poetry", chapters: 8, aliases: ["sng", "song", "sos", "song of songs", "song of solomon", "canticles"] },
  { code: "ISA", order: 23, name: "Isaiah", testament: "OT", genre: "prophecy", chapters: 66, aliases: ["isa", "is"] },
  { code: "JER", order: 24, name: "Jeremiah", testament: "OT", genre: "prophecy", chapters: 52, aliases: ["jer", "je", "jr"] },
  { code: "LAM", order: 25, name: "Lamentations", testament: "OT", genre: "poetry", chapters: 5, aliases: ["lam", "la"] },
  { code: "EZK", order: 26, name: "Ezekiel", testament: "OT", genre: "prophecy", chapters: 48, aliases: ["ezk", "eze", "ezek"] },
  { code: "DAN", order: 27, name: "Daniel", testament: "OT", genre: "apocalyptic", chapters: 12, aliases: ["dan", "da", "dn"] },
  { code: "HOS", order: 28, name: "Hosea", testament: "OT", genre: "prophecy", chapters: 14, aliases: ["hos", "ho"] },
  { code: "JOL", order: 29, name: "Joel", testament: "OT", genre: "prophecy", chapters: 3, aliases: ["jol", "joel", "jl"] },
  { code: "AMO", order: 30, name: "Amos", testament: "OT", genre: "prophecy", chapters: 9, aliases: ["amo", "am"] },
  { code: "OBA", order: 31, name: "Obadiah", testament: "OT", genre: "prophecy", chapters: 1, aliases: ["oba", "ob", "obad"] },
  { code: "JON", order: 32, name: "Jonah", testament: "OT", genre: "prophecy", chapters: 4, aliases: ["jon", "jnh"] },
  { code: "MIC", order: 33, name: "Micah", testament: "OT", genre: "prophecy", chapters: 7, aliases: ["mic", "mi"] },
  { code: "NAM", order: 34, name: "Nahum", testament: "OT", genre: "prophecy", chapters: 3, aliases: ["nam", "nah", "na"] },
  { code: "HAB", order: 35, name: "Habakkuk", testament: "OT", genre: "prophecy", chapters: 3, aliases: ["hab", "hbk"] },
  { code: "ZEP", order: 36, name: "Zephaniah", testament: "OT", genre: "prophecy", chapters: 3, aliases: ["zep", "zeph", "zp"] },
  { code: "HAG", order: 37, name: "Haggai", testament: "OT", genre: "prophecy", chapters: 2, aliases: ["hag", "hg"] },
  { code: "ZEC", order: 38, name: "Zechariah", testament: "OT", genre: "prophecy", chapters: 14, aliases: ["zec", "zech", "zc"] },
  { code: "MAL", order: 39, name: "Malachi", testament: "OT", genre: "prophecy", chapters: 4, aliases: ["mal", "ml"] },

  // New Testament
  { code: "MAT", order: 40, name: "Matthew", testament: "NT", genre: "gospel", chapters: 28, aliases: ["mat", "matt", "mt"] },
  { code: "MRK", order: 41, name: "Mark", testament: "NT", genre: "gospel", chapters: 16, aliases: ["mrk", "mark", "mk", "mr"] },
  { code: "LUK", order: 42, name: "Luke", testament: "NT", genre: "gospel", chapters: 24, aliases: ["luk", "luke", "lk"] },
  { code: "JHN", order: 43, name: "John", testament: "NT", genre: "gospel", chapters: 21, aliases: ["jhn", "john", "jn", "joh"] },
  { code: "ACT", order: 44, name: "Acts", testament: "NT", genre: "acts", chapters: 28, aliases: ["act", "acts", "ac"] },
  { code: "ROM", order: 45, name: "Romans", testament: "NT", genre: "epistle", chapters: 16, aliases: ["rom", "ro", "rm"] },
  { code: "1CO", order: 46, name: "1 Corinthians", testament: "NT", genre: "epistle", chapters: 16, aliases: ["1co", "1cor", "1 cor", "1 corinthians"] },
  { code: "2CO", order: 47, name: "2 Corinthians", testament: "NT", genre: "epistle", chapters: 13, aliases: ["2co", "2cor", "2 cor", "2 corinthians"] },
  { code: "GAL", order: 48, name: "Galatians", testament: "NT", genre: "epistle", chapters: 6, aliases: ["gal", "ga"] },
  { code: "EPH", order: 49, name: "Ephesians", testament: "NT", genre: "epistle", chapters: 6, aliases: ["eph", "ep"] },
  { code: "PHP", order: 50, name: "Philippians", testament: "NT", genre: "epistle", chapters: 4, aliases: ["php", "phil", "pp", "philippians"] },
  { code: "COL", order: 51, name: "Colossians", testament: "NT", genre: "epistle", chapters: 4, aliases: ["col", "cl"] },
  { code: "1TH", order: 52, name: "1 Thessalonians", testament: "NT", genre: "epistle", chapters: 5, aliases: ["1th", "1thess", "1 thess", "1 thessalonians"] },
  { code: "2TH", order: 53, name: "2 Thessalonians", testament: "NT", genre: "epistle", chapters: 3, aliases: ["2th", "2thess", "2 thess", "2 thessalonians"] },
  { code: "1TI", order: 54, name: "1 Timothy", testament: "NT", genre: "epistle", chapters: 6, aliases: ["1ti", "1tim", "1 tim", "1 timothy"] },
  { code: "2TI", order: 55, name: "2 Timothy", testament: "NT", genre: "epistle", chapters: 4, aliases: ["2ti", "2tim", "2 tim", "2 timothy"] },
  { code: "TIT", order: 56, name: "Titus", testament: "NT", genre: "epistle", chapters: 3, aliases: ["tit", "ti"] },
  { code: "PHM", order: 57, name: "Philemon", testament: "NT", genre: "epistle", chapters: 1, aliases: ["phm", "phlm", "philemon", "pm"] },
  { code: "HEB", order: 58, name: "Hebrews", testament: "NT", genre: "epistle", chapters: 13, aliases: ["heb", "hbr"] },
  { code: "JAS", order: 59, name: "James", testament: "NT", genre: "epistle", chapters: 5, aliases: ["jas", "james", "jm"] },
  { code: "1PE", order: 60, name: "1 Peter", testament: "NT", genre: "epistle", chapters: 5, aliases: ["1pe", "1pet", "1 pet", "1 peter"] },
  { code: "2PE", order: 61, name: "2 Peter", testament: "NT", genre: "epistle", chapters: 3, aliases: ["2pe", "2pet", "2 pet", "2 peter"] },
  { code: "1JN", order: 62, name: "1 John", testament: "NT", genre: "epistle", chapters: 5, aliases: ["1jn", "1joh", "1 jn", "1 john"] },
  { code: "2JN", order: 63, name: "2 John", testament: "NT", genre: "epistle", chapters: 1, aliases: ["2jn", "2joh", "2 jn", "2 john"] },
  { code: "3JN", order: 64, name: "3 John", testament: "NT", genre: "epistle", chapters: 1, aliases: ["3jn", "3joh", "3 jn", "3 john"] },
  { code: "JUD", order: 65, name: "Jude", testament: "NT", genre: "epistle", chapters: 1, aliases: ["jud", "jude", "jd"] },
  { code: "REV", order: 66, name: "Revelation", testament: "NT", genre: "apocalyptic", chapters: 22, aliases: ["rev", "re", "apocalypse", "revelations"] },
] as const;

export const BOOK_COUNT = BOOKS.length;

/** Total chapters across the canon. A structural invariant worth asserting. */
export const CHAPTER_COUNT = BOOKS.reduce((sum, b) => sum + b.chapters, 0);

const BY_CODE = new Map<string, Book>(BOOKS.map((b) => [b.code, b]));
const BY_ORDER = new Map<number, Book>(BOOKS.map((b) => [b.order, b]));

/** Every accepted spelling, lowercased and stripped of spaces and periods. */
const BY_ALIAS = new Map<string, Book>();
for (const book of BOOKS) {
  const keys = new Set<string>([
    book.code.toLowerCase(),
    book.name.toLowerCase(),
    ...book.aliases,
  ]);
  for (const key of keys) {
    const normalized = normalizeBookKey(key);
    const claimed = BY_ALIAS.get(normalized);
    // An ambiguous alias would silently resolve citations to the wrong book,
    // so it is a hard error rather than a last-writer-wins overwrite.
    if (claimed && claimed.code !== book.code) {
      throw new Error(
        `Ambiguous book alias "${key}": claimed by both ${claimed.code} and ${book.code}`,
      );
    }
    BY_ALIAS.set(normalized, book);
  }
}

/** Collapses "1 Cor.", "1cor", and "I Corinthians" toward a single form. */
export function normalizeBookKey(input: string): string {
  return input
    .toLowerCase()
    .trim()
    // Roman numeral prefixes are common in older citation styles.
    .replace(/^(i{1,3})\s+/, (_m, n: string) => `${n.length} `)
    .replace(/^first\s+/, "1 ")
    .replace(/^second\s+/, "2 ")
    .replace(/^third\s+/, "3 ")
    .replace(/[.\u2019']/g, "")
    .replace(/\s+/g, "");
}

export function getBook(code: string): Book | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function getBookByOrder(order: number): Book | undefined {
  return BY_ORDER.get(order);
}

/** Resolves a human-written book name to a canonical book, or undefined. */
export function lookupBook(input: string): Book | undefined {
  return BY_ALIAS.get(normalizeBookKey(input));
}

export function isValidBookCode(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}
