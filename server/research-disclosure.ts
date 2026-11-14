/**
 * Conservative fail-closed disclosure screen. This is not an entity recognizer: any distinctive
 * token shared with private context, or any direct identifier in the query, requires approval.
 * An autonomous query therefore contains no screened term from notes, history or this turn's input.
 */

const genericTerms = new Set(
  `a about after again all also an and any are as at be because been before being between both but by can could did do does doing down during each few find for from further had has have having he her here hers him his how i if in information into is it its just latest more most my news no not of off on once only or other our out over own plan planning public research same search she should so some such than that the their them then there these they this those through to too under until up update updates very was we web were what when where which while who why will with would you your subject private company companies employee employees work works https http www com org net io`.split(
    " ",
  ),
);
for (const acronym of ["AI", "API", "CEO", "EU", "GDP", "HR", "IT", "PDF", "US", "USA"])
  genericTerms.add(acronym.toLowerCase());

const emailPattern =
  /(?:^|[^\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,4}\.[\p{L}]{2,24}(?=$|[^\p{L}\p{N}])/u;
// No ASCII word boundary: identifiers are commonly embedded after `_` or inside labels.
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu;
const ibanPattern =
  /(?:^|[^\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{2,4}){2,12}(?=$|[^\p{L}\p{N}])/iu;
const digitSequencePattern = /\+?\d[\d ()./:-]{2,}\d/gu;
// No ASCII word boundary: `account_1234` is an identifier too.
const longNumberPattern = /(?<!\d)\d{4,}(?!\d)/gu;
const yearPattern = /^(?:18|19|20|21)\d{2}$/u;
const termPattern = /[\p{L}\p{N}]+/gu;
const nonLatinPattern = /[^\p{Script=Latin}\p{N}\p{M}]/u;
const urlPattern = /https?:\/\/[^\s"'<>]+/giu;

const invisiblePattern = /[\p{Cf}\u{E0000}-\u{E007F}]/gu;
// Letters that have no Unicode decomposition, mapped to their usual ASCII spelling.
const undecomposedLetters: Record<string, string> = {
  ı: "i",
  ß: "ss",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  æ: "ae",
  œ: "oe",
};
const undecomposedPattern = /[ıßøłđðþæœ]/gu;

/**
 * NFKD and a mark strip remove accents (İ becomes I plus a dot). Lowercasing comes before the
 * letter table so both cases of a letter fold alike, and NFC puts Hangul syllables back together.
 */
function fold(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(undecomposedPattern, (letter) => undecomposedLetters[letter]!)
    .normalize("NFC");
}

/**
 * Pasted text can carry soft hyphens or zero-width characters inside a word or between two.
 * Screening both readings keeps `Ma\u00ADya` matching `Maya` without gluing separate words.
 */
function privateReadings(text: string) {
  const joined = text.replace(invisiblePattern, "");
  return joined === text ? [text] : [joined, text.replace(invisiblePattern, " ")];
}

// Final consonants that soften before a vowel suffix: kitap/kitabi, Ahmet/Ahmedin, cocuk/cocugu.
const softened: Record<string, string> = { p: "b", t: "d", k: "g" };

/**
 * Notes hold inflected forms and search queries hold base forms, in either direction. Both terms
 * are specific and at least four letters, so short common words cannot act as prefixes.
 */
function sharesStem(left: string, right: string) {
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (long.startsWith(short)) return true;
  if (short.length < 5 || long.length === short.length) return false;
  const stem = short.slice(0, -1);
  return long.startsWith(stem) && softened[short.at(-1)!] === long[stem.length];
}

/** Map every Unicode decimal digit to ASCII, so identifier patterns see one form. */
function asciiDigits(value: string) {
  let result = "";
  for (const character of value) {
    if (!/^\p{Nd}$/u.test(character)) {
      result += character;
      continue;
    }
    // Decimal digits form contiguous runs of ten starting at a script-specific zero.
    const digit = character.codePointAt(0)!;
    let zero = digit;
    while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--;
    result += String((digit - zero) % 10);
  }
  return result;
}

function normalizedUrls(value: string) {
  return [...value.normalize("NFKC").matchAll(urlPattern)].map((match) =>
    match[0]
      .toLowerCase()
      .replace(/#.*$/u, "")
      .replace(/[.,;:!?)\]]+$/u, "")
      .replace(/\/+$/u, ""),
  );
}

function terms(value: string) {
  // Compare punctuation-stripped variants too: a private `D'Angelo` still matches `DAngelo`.
  const variants = [value, value.replace(/['’\p{Pd}]/gu, "")];
  return [
    ...new Set(
      variants.flatMap((variant) => [...variant.matchAll(termPattern)].map((match) => match[0])),
    ),
  ];
}

function isSpecificTerm(term: string) {
  if (genericTerms.has(term) || /^\p{N}+$/u.test(term)) return false;
  // A single Latin character is usually noise; even one uncased-script character can identify.
  return term.length >= 2 || nonLatinPattern.test(term);
}

/** Two-character windows catch names in scripts that do not separate words with spaces. */
function sharesNonLatinFragment(term: string, query: string) {
  if (!nonLatinPattern.test(term)) return false;
  const characters = Array.from(term);
  for (let index = 0; index + 1 < characters.length; index++)
    if (query.includes(characters[index]! + characters[index + 1]!)) return true;
  return false;
}

function hasPrivateOverlap(question: string, privateTexts: readonly string[]) {
  const query = fold(question);
  const queryTerms = [...terms(query)];
  const queryTermSet = new Set(queryTerms);
  // Only distinctive Latin query terms take part in stem and joined-form matching.
  const stemQueryTerms = queryTerms.filter(
    (term) => term.length >= 4 && isSpecificTerm(term) && !nonLatinPattern.test(term),
  );
  // URL identity survives even when every path label is a single character.
  const queryUrls = new Set(normalizedUrls(query));
  for (const text of privateTexts.flatMap(privateReadings)) {
    const folded = fold(text);
    if (queryUrls.size > 0 && normalizedUrls(folded).some((url) => queryUrls.has(url))) return true;
    for (const term of terms(folded)) {
      if (!isSpecificTerm(term)) continue;
      if (nonLatinPattern.test(term)) {
        if (query.includes(term) || sharesNonLatinFragment(term, query)) return true;
        continue;
      }
      if (queryTermSet.has(term)) return true;
      if (term.length < 4) continue;
      for (const queryTerm of stemQueryTerms) {
        // Inflected forms: Yilmazlarin and Yilmaz, Hendersons and Henderson.
        if (sharesStem(term, queryTerm)) return true;
        // Joined forms keep the private term inside one query token: #MayaChen, northstarlabs.
        if (term.length >= 5 && queryTerm.includes(term)) return true;
      }
    }
  }
  return false;
}

function hasDirectIdentifier(question: string) {
  // Invisible format and tag characters can hide or alter a disclosed token.
  if (/[\p{Cf}\u{E0000}-\u{E007F}]/u.test(question)) return true;
  const text = asciiDigits(question.normalize("NFKC"));
  if (emailPattern.test(text) || uuidPattern.test(text) || ibanPattern.test(text)) return true;
  for (const match of text.matchAll(digitSequencePattern)) {
    if (match[0].replace(/\D/gu, "").length >= 7) return true;
  }
  for (const match of text.matchAll(longNumberPattern)) {
    if (!yearPattern.test(match[0])) return true;
  }
  return false;
}

export type ResearchQuestionInspection =
  | { status: "generalized"; outboundQuestion: string }
  | {
      status: "approval_required";
      reason:
        | "explicit_private_details"
        | "private_context_overlap"
        | "direct_identifier"
        | "context_unavailable";
    };

/**
 * Only a query with no distinctive term shared with private context and no direct identifier may
 * leave Atlas autonomously. Everything else shows its exact outbound text for explicit approval.
 * The model flag can only escalate to approval; it never grants permission.
 */
export function inspectResearchQuestion({
  question,
  privateTexts,
  requiresPrivateDisclosure = false,
  contextUncertain = false,
}: {
  question: string;
  privateTexts: readonly string[];
  requiresPrivateDisclosure?: boolean;
  contextUncertain?: boolean;
}): ResearchQuestionInspection {
  if (requiresPrivateDisclosure)
    return { status: "approval_required", reason: "explicit_private_details" };
  if (contextUncertain) return { status: "approval_required", reason: "context_unavailable" };
  if (hasPrivateOverlap(question, privateTexts))
    return { status: "approval_required", reason: "private_context_overlap" };
  if (hasDirectIdentifier(question))
    return { status: "approval_required", reason: "direct_identifier" };
  return { status: "generalized", outboundQuestion: question };
}
