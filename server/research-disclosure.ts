/**
 * Conservative local query generalization. This is a backend disclosure guard, not an entity
 * recognizer: uncertain or over-broad context is sent to approval rather than to a provider.
 */
const genericCapitalizedWords = new Set(
  `A An And As At About After All Also Are Be Because Before But By Can Could Do Does For From Had Has Have He Her Here Hers Him His How I In Into Is It Its May Me More Most My No Not Of On Or Our She So Some Such Than That The Their Them There These They This Those To Was We Were What When Where Which Who Why Will With Would You Your`
    .toLowerCase()
    .split(" "),
);

const commonTerms = new Set(
  `a about after again all also an and any are as at be because been before being between both but by can could did do does doing down during each few find for from further had has have having he her here hers him his how i if in information into is it its just more most my no not of off on once only or other our out over own public research same search she should so some such than that the their them then there these they this those through to too under until up very was we web were what when where which while who why will with would you your subject private`.split(
    " ",
  ),
);

const commonAcronyms = new Set(["AI", "API", "CEO", "EU", "GDP", "HR", "IT", "PDF", "US", "USA"]);
const emailPattern = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[A-Za-z]{2,}/gu;
const uuidPattern =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const longNumberPattern = /\b\d[\d,./-]{3,}\d\b/gu;
const phonePattern = /(?:\+\d[\d ().-]{6,}\d|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})/gu;
const yearPattern = /^(?:19|20|21)\d{2}$/u;
const datePattern = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/u;
const quotedPhrasePattern = /[“"]([^“”"\n]{8,160})[”"]/gu;
const capitalizedWordPattern = /\p{Lu}[\p{L}\p{M}\p{N}'’.-]{2,}/gu;
const privateWordPattern = /[\p{L}\p{N}]+/gu;
const MAX_PRIVATE_MARKERS = 512;

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function privateMarkers(privateTexts: readonly string[], privatePhraseTexts: readonly string[]) {
  const markers = new Set<string>();
  let truncated = false;
  const add = (value: string) => {
    if (markers.has(value)) return;
    if (markers.size >= MAX_PRIVATE_MARKERS) {
      truncated = true;
      return;
    }
    markers.add(value);
  };
  for (const text of privateTexts) {
    for (const pattern of [emailPattern, uuidPattern, phonePattern, quotedPhrasePattern]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) if (match[0]) add(match[0].trim());
    }
    for (const match of text.matchAll(longNumberPattern)) {
      const value = match[0]!.trim();
      if (!yearPattern.test(value) && !datePattern.test(value)) add(value);
    }
    for (const match of text.matchAll(capitalizedWordPattern)) {
      const word = match[0]!.replace(/^[.'’_-]+|[.'’_-]+$/gu, "");
      if (word.length < 3) continue;
      const normalized = normalize(word);
      if (!genericCapitalizedWords.has(normalized) && !commonAcronyms.has(word)) add(word);
    }
  }
  for (const text of privatePhraseTexts) {
    const words = [...text.matchAll(privateWordPattern)];
    for (let start = 0; start + 2 < words.length; start++) {
      const first = words[start]!;
      const last = words[start + 2]!;
      const phrase = text.slice(first.index, last.index + last[0].length);
      const specificWords = words
        .slice(start, start + 3)
        .filter(([word]) => word.length > 2 && !commonTerms.has(normalize(word))).length;
      if (phrase.length >= 18 && specificWords >= 2) add(phrase);
      if (truncated) break;
    }
    if (truncated) break;
  }
  return { values: [...markers].sort((left, right) => right.length - left.length), truncated };
}

function replacePrivateMarker(query: string, marker: string) {
  const escaped = escapeRegExp(marker).replace(/\s+/gu, "\\s+");
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "giu");
  return query.replace(pattern, (_match, prefix: string) => `${prefix}the subject`);
}

function replaceDirectIdentifiers(query: string) {
  return query
    .replace(emailPattern, "the subject")
    .replace(uuidPattern, "the subject")
    .replace(phonePattern, "the subject")
    .replace(longNumberPattern, (value) =>
      yearPattern.test(value) || datePattern.test(value) ? value : "the subject",
    );
}

function meaningfulTermCount(query: string) {
  return (
    normalize(query)
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((term) => term.length > 2 && !commonTerms.has(term)).length ?? 0
  );
}

export type ResearchQuestionInspection =
  | { status: "generalized"; outboundQuestion: string; redacted: boolean }
  | {
      status: "approval_required";
      reason: "explicit_private_details" | "not_usefully_generalized";
    };

/**
 * Private specifics found in the current turn's notes/history are removed before autonomous
 * research. If the remaining query would be too vague, the exact proposed query needs approval.
 * The model flag can only escalate to approval; it never grants permission.
 */
export function inspectResearchQuestion({
  question,
  privateTexts,
  privatePhraseTexts = [],
  requiresPrivateDisclosure = false,
  contextUncertain = false,
}: {
  question: string;
  privateTexts: readonly string[];
  privatePhraseTexts?: readonly string[];
  requiresPrivateDisclosure?: boolean;
  contextUncertain?: boolean;
}): ResearchQuestionInspection {
  if (requiresPrivateDisclosure)
    return { status: "approval_required", reason: "explicit_private_details" };
  if (contextUncertain) return { status: "approval_required", reason: "not_usefully_generalized" };

  let outboundQuestion = replaceDirectIdentifiers(question);
  const markers = privateMarkers(privateTexts, privatePhraseTexts);
  if (markers.truncated) return { status: "approval_required", reason: "not_usefully_generalized" };
  for (const marker of markers.values)
    outboundQuestion = replacePrivateMarker(outboundQuestion, marker);
  outboundQuestion = outboundQuestion
    .replace(/\bthe subject(?:\s+the subject)+\b/giu, "the subject")
    .replace(/\s+/gu, " ")
    .trim();

  const redacted = outboundQuestion !== question;
  if (redacted && meaningfulTermCount(outboundQuestion) < 2)
    return { status: "approval_required", reason: "not_usefully_generalized" };
  return { status: "generalized", outboundQuestion, redacted };
}
