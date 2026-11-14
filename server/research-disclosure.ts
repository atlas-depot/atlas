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
  /(?:^|[^\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,4}\.[A-Za-z]{2,24}(?=$|[^\p{L}\p{N}])/u;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const ibanPattern =
  /(?:^|[^\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{2,4}){2,12}(?=$|[^\p{L}\p{N}])/iu;
const digitSequencePattern = /\+?\d[\d ()./:-]{2,}\d/gu;
const longNumberPattern = /\b\d{4,}\b/gu;
const yearPattern = /^(?:18|19|20|21)\d{2}$/u;
const termPattern = /[\p{L}\p{N}]+/gu;
const nonLatinPattern = /[^\p{Script=Latin}\p{N}\p{M}]/u;

/** NFKC plus Turkish-safe folding, so NFD text and I/ı/İ/i compare as one form. */
function fold(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0130\u0131]/gu, "i")
    .replace(/I/gu, "i")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

function terms(value: string) {
  return [...value.matchAll(termPattern)].map((match) => match[0]);
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
  const queryTerms = new Set(terms(query));
  for (const text of privateTexts) {
    const folded = fold(text);
    for (const term of terms(folded)) {
      if (!isSpecificTerm(term)) continue;
      if (queryTerms.has(term) || sharesNonLatinFragment(term, query)) return true;
    }
  }
  return false;
}

function hasDirectIdentifier(question: string) {
  if (emailPattern.test(question) || uuidPattern.test(question) || ibanPattern.test(question))
    return true;
  for (const match of question.matchAll(digitSequencePattern)) {
    if (match[0].replace(/\D/gu, "").length >= 7) return true;
  }
  for (const match of question.matchAll(longNumberPattern)) {
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
