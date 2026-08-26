/**
 * Verse numbers that exist in the traditional versification but carry no text
 * in the Berean Standard Bible.
 *
 * These are not gaps in the corpus. The BSB follows the earliest and most
 * reliable Greek manuscripts, in which these lines are absent; they entered
 * the tradition later and are preserved in the KJV, which was translated from
 * a later manuscript family. The verse *numbers* are retained so that
 * chapter-and-verse references stay aligned across translations.
 *
 * This list is kept as data for two reasons. The corpus verifier asserts that
 * exactly these verses are missing and no others, so a genuinely truncated
 * build still fails loudly. And when a user asks after one of them, the system
 * can say plainly why it is not there instead of returning nothing or, worse,
 * inventing text to fill the hole.
 */

export interface Omission {
  ref: string;
  /** Where the traditional wording is preserved, for the curious reader. */
  note: string;
}

export const OMITTED_VERSES: Readonly<Record<string, Omission>> = {
  "MAT 17:21": {
    ref: "Matthew 17:21",
    note: "Absent from the earliest manuscripts; compare Mark 9:29.",
  },
  "MAT 18:11": {
    ref: "Matthew 18:11",
    note: "Absent from the earliest manuscripts; compare Luke 19:10.",
  },
  "MAT 23:14": {
    ref: "Matthew 23:14",
    note: "Absent from the earliest manuscripts; compare Mark 12:40 and Luke 20:47.",
  },
  "MRK 7:16": {
    ref: "Mark 7:16",
    note: "Absent from the earliest manuscripts; compare Mark 4:9, 4:23.",
  },
  "MRK 9:44": {
    ref: "Mark 9:44",
    note: "Absent from the earliest manuscripts; repeats Mark 9:48.",
  },
  "MRK 9:46": {
    ref: "Mark 9:46",
    note: "Absent from the earliest manuscripts; repeats Mark 9:48.",
  },
  "MRK 11:26": {
    ref: "Mark 11:26",
    note: "Absent from the earliest manuscripts; compare Matthew 6:15.",
  },
  "MRK 15:28": {
    ref: "Mark 15:28",
    note: "Absent from the earliest manuscripts; compare Luke 22:37 and Isaiah 53:12.",
  },
  "LUK 17:36": {
    ref: "Luke 17:36",
    note: "Absent from the earliest manuscripts; compare Matthew 24:40.",
  },
  "LUK 23:17": {
    ref: "Luke 23:17",
    note: "Absent from the earliest manuscripts; compare Matthew 27:15 and Mark 15:6.",
  },
  "JHN 5:4": {
    ref: "John 5:4",
    note: "Absent from the earliest manuscripts; an early explanatory gloss on John 5:7.",
  },
  "ACT 8:37": {
    ref: "Acts 8:37",
    note: "Absent from the earliest manuscripts.",
  },
  "ACT 15:34": {
    ref: "Acts 15:34",
    note: "Absent from the earliest manuscripts.",
  },
  "ACT 24:7": {
    ref: "Acts 24:7",
    note: "Absent from the earliest manuscripts.",
  },
  "ACT 28:29": {
    ref: "Acts 28:29",
    note: "Absent from the earliest manuscripts.",
  },
  "ROM 16:24": {
    ref: "Romans 16:24",
    note: "Absent from the earliest manuscripts; compare Romans 16:20.",
  },
} as const;

export const OMITTED_COUNT = Object.keys(OMITTED_VERSES).length;

function key(book: string, chapter: number, verse: number): string {
  return `${book.toUpperCase()} ${chapter}:${verse}`;
}

export function isOmittedVerse(
  book: string,
  chapter: number,
  verse: number,
): boolean {
  return key(book, chapter, verse) in OMITTED_VERSES;
}

export function omissionFor(
  book: string,
  chapter: number,
  verse: number,
): Omission | undefined {
  return OMITTED_VERSES[key(book, chapter, verse)];
}
