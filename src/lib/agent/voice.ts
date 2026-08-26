/**
 * Voice auditor: the model is instructed not to speak as God or as itself,
 * and this is the check that instruction is not trusted to satisfy.
 *
 * A blanket ban on "I" would fight ordinary English ("the psalmist's 'I'").
 * What is refused is a short list of shapes that actually do the harm:
 * God-voice, and the tool offering a presence it does not have.
 */

export interface VoiceProblem {
  phrase: string;
  detail: string;
}

interface Pattern {
  re: RegExp;
  phrase: string;
  kind: "god" | "tool";
}

const PATTERNS: Pattern[] = [
  {
    re: /\bi am with you\b/i,
    phrase: "I am with you",
    kind: "god",
  },
  {
    re: /\bi['’]m with you\b/i,
    phrase: "I'm with you",
    kind: "god",
  },
  {
    re: /\bi have heard\b/i,
    phrase: "I have heard",
    kind: "god",
  },
  {
    re: /\bi['’]ve heard\b/i,
    phrase: "I've heard",
    kind: "god",
  },
  {
    re: /\bi forgive you\b/i,
    phrase: "I forgive you",
    kind: "god",
  },
  {
    re: /\bgod wants you to know\b/i,
    phrase: "God wants you to know",
    kind: "god",
  },
  {
    re: /\bthe lord is telling you\b/i,
    phrase: "the Lord is telling you",
    kind: "god",
  },
  {
    re: /\bgod is telling you\b/i,
    phrase: "God is telling you",
    kind: "god",
  },
  {
    re: /\bi found\b/i,
    phrase: "I found",
    kind: "tool",
  },
  {
    re: /\bi looked\b/i,
    phrase: "I looked",
    kind: "tool",
  },
  {
    re: /\bi think\b/i,
    phrase: "I think",
    kind: "tool",
  },
  {
    re: /\bi hear you\b/i,
    phrase: "I hear you",
    kind: "tool",
  },
  {
    re: /\bi['’]m here\b/i,
    phrase: "I'm here",
    kind: "tool",
  },
  {
    re: /\bi am here\b/i,
    phrase: "I am here",
    kind: "tool",
  },
  {
    re: /\bi sense that\b/i,
    phrase: "I sense that",
    kind: "god",
  },
];

function detailFor(kind: "god" | "tool", phrase: string): string {
  if (kind === "god") {
    return (
      `The response speaks as God ("${phrase}"). ` +
      `Scripture speaks; this tool reports what it says. ` +
      `Rewrite without claiming God's voice, will, or presence.`
    );
  }
  return (
    `The response speaks as this tool ("${phrase}"). ` +
    `Do not write in the first person as Lectern. ` +
    `Let Scripture be the subject — for example, "God's Word reminds us that…".`
  );
}

/**
 * Finds God-voice and tool-as-subject phrasing in model prose.
 *
 * Inclusive "we/us" as fellow readers is allowed. A universal ban on "I" is
 * not attempted.
 */
export function auditVoice(prose: string): VoiceProblem[] {
  const problems: VoiceProblem[] = [];
  const seen = new Set<string>();

  for (const pattern of PATTERNS) {
    if (!pattern.re.test(prose)) continue;
    if (seen.has(pattern.phrase)) continue;
    seen.add(pattern.phrase);
    problems.push({
      phrase: pattern.phrase,
      detail: detailFor(pattern.kind, pattern.phrase),
    });
  }

  return problems;
}
