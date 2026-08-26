/**
 * Crisis detection and response.
 *
 * When someone discloses suicidal intent, self-harm, abuse, or immediate
 * danger, this path runs instead of the model. No generation, no retrieval, no
 * improvisation — a fixed message written by a human being, pointing to other
 * human beings who can actually help.
 *
 * That is a deliberate limitation. A person in that moment needs competent
 * human contact now, and the downside of a generated response landing badly is
 * severe and irreversible. Knowing where its usefulness ends is part of what
 * makes this a good tool.
 *
 * Detection is intentionally over-inclusive. A false positive costs someone a
 * message with a phone number in it. A false negative costs something else.
 */

export interface CrisisMatch {
  kind: "self-harm" | "abuse" | "harm-to-others";
  /** The phrase that triggered detection, for logging and evaluation. */
  trigger: string;
}

interface Rule {
  kind: CrisisMatch["kind"];
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    kind: "self-harm",
    patterns: [
      /\bkill(?:ing)?\s+my\s?self\b/i,
      /\bkill\s+me\b/i,
      /\bend(?:ing)?\s+(?:my|it)\s+(?:life|all)\b/i,
      /\bend\s+it\s+all\b/i,
      /\btake\s+my\s+own\s+life\b/i,
      /\bsuicid(?:e|al)\b/i,
      /\bwant\s+to\s+die\b/i,
      /\bwish\s+(?:i\s+(?:was|were)\s+dead|i\s+could\s+die)\b/i,
      /\bbetter\s+off\s+(?:dead|without\s+me)\b/i,
      /\bdon'?t\s+want\s+to\s+(?:be\s+here|live|wake\s+up)\b/i,
      /\bno\s+reason\s+to\s+(?:live|go\s+on)\b/i,
      /\bcut(?:ting)?\s+my\s?self\b/i,
      /\bhurt(?:ing)?\s+my\s?self\b/i,
      /\bharm(?:ing)?\s+my\s?self\b/i,
      /\bself[-\s]?harm\b/i,
      /\boverdos(?:e|ing)\b/i,
    ],
  },
  {
    kind: "harm-to-others",
    patterns: [
      /\bkill(?:ing)?\s+(?:him|her|them|someone|somebody|my\s+\w+)\b/i,
      /\bhurt(?:ing)?\s+(?:my\s+(?:kids?|child|children|wife|husband))\b/i,
      /\bshoot\s+(?:up|him|her|them)\b/i,
    ],
  },
  {
    kind: "abuse",
    patterns: [
      /\b(?:he|she|they|husband|wife|partner|dad|father|mom|mother|boyfriend|girlfriend)\s+(?:hits?|beats?|hit|beat|chokes?|strangles?)\s+me\b/i,
      /\b(?:being|been|is)\s+(?:sexually\s+)?(?:abused|assaulted|raped)\b/i,
      /\b(?:he|she|they)\s+(?:rap(?:ed|es)|molest(?:ed|s)?)\s+me\b/i,
      /\bdomestic\s+(?:violence|abuse)\b/i,
      /\bafraid\s+(?:for\s+my\s+life|he('?s|\s+is)\s+going\s+to\s+kill\s+me)\b/i,
      /\bnot\s+safe\s+at\s+home\b/i,
    ],
  },
];

/**
 * Negations and reported speech that would otherwise trip detection.
 *
 * Kept narrow on purpose. Only phrasings that are clearly *about* the topic
 * rather than a disclosure are excluded, and anything ambiguous still matches.
 */
const EXCLUSIONS: RegExp[] = [
  /\b(?:don'?t|do\s+not|never|no\s+longer)\s+want\s+to\s+(?:die|kill)\b/i,
  /\bused\s+to\s+(?:want\s+to\s+die|feel\s+suicidal)\b/i,
  /\bhow\s+(?:do|can)\s+i\s+help\s+(?:someone|a\s+friend|my\s+friend)\b/i,
  /\bsuicide\s+(?:prevention|hotline|awareness)\b/i,
];

export function detectCrisis(text: string): CrisisMatch | null {
  if (!text) return null;

  for (const exclusion of EXCLUSIONS) {
    if (exclusion.test(text)) return null;
  }

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(text);
      if (match) return { kind: rule.kind, trigger: match[0] };
    }
  }

  return null;
}

/**
 * The response. Written to be read by someone who is not in a state to read
 * much: short sentences, the practical step first, no theology homework, and
 * nothing that sounds like it came from a machine trying to be profound.
 */
export function crisisResponse(match: CrisisMatch): string {
  const shared = [
    "Please talk to someone who can be with you right now.",
    "",
    "- **In the US**: call or text **988** (Suicide and Crisis Lifeline), any time.",
    "- **In the UK and Ireland**: call **116 123** (Samaritans), any time.",
    "- **Anywhere**: your local emergency number, or go to the nearest emergency room.",
    "- **International directory**: https://findahelpline.com",
  ];

  if (match.kind === "abuse") {
    return [
      "I'm glad you said something. What you're describing is serious, and you deserve real help from people who can actually protect you.",
      "",
      "- **In the US**: National Domestic Violence Hotline, **1-800-799-7233**, or text START to **88788**.",
      "- **In the UK**: National Domestic Abuse Helpline, **0808 2000 247**.",
      "- **In immediate danger**: call your local emergency number.",
      "- **International directory**: https://findahelpline.com",
      "",
      "I'm a tool for praying with Scripture, and this is past what I should be handling. Please reach out to one of these, and if you can, tell someone you trust in person — a pastor, a friend, a doctor.",
      "",
      "None of this is your fault, and being harmed is not something God is asking you to endure quietly.",
    ].join("\n");
  }

  if (match.kind === "harm-to-others") {
    return [
      "I'm not able to help with this, and I want to be straight with you about why: what you're describing could seriously hurt someone.",
      "",
      ...shared,
      "",
      "Please talk to someone today — a crisis line, a doctor, or your local emergency number. If someone is in immediate danger, call emergency services now.",
    ].join("\n");
  }

  return [
    "I'm glad you told me. I want to stop and say this plainly: I'm a piece of software, and this is more than I should be handling on my own.",
    "",
    ...shared,
    "",
    "If you can, reach out to someone who knows you — a pastor, a friend, a family member — and let them sit with you tonight. You shouldn't have to carry this by yourself.",
    "",
    "Your life has real worth. Not because of how you feel right now, and not because of anything you've done or failed to do.",
  ].join("\n");
}
