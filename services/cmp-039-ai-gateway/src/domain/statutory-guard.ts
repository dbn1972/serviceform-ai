/**
 * Decision boundary (AI-GOVERNANCE.md, Architecture Constitution): AI may draft, extract,
 * summarize, explain, recommend non-binding content, generate tests and assist officials. It never
 * issues a statutory eligibility, approval, rejection, penalty or entitlement decision.
 */
export const ALLOWED_TASK_KINDS = [
  'DRAFT',
  'EXTRACT',
  'SUMMARIZE',
  'EXPLAIN',
  'RECOMMEND_NON_BINDING',
  'GENERATE_TESTS',
  'ASSIST_OFFICIAL',
  'EMBED',
] as const;
export type TaskKind = (typeof ALLOWED_TASK_KINDS)[number];

export const ALLOWED_TOOL_EFFECTS = ['READ_ONLY', 'DRAFT_ONLY'] as const;

const DECISION_WORDS =
  /(?:ELIGIB|APPROV|REJECT|PENALT|ENTITLE|ADJUDICAT|SANCTION|DECISION|DENY|GRANT)/i;

export function isAllowedTaskKind(value: string): value is TaskKind {
  return (ALLOWED_TASK_KINDS as readonly string[]).includes(value);
}

export function isStatutoryDecisionKind(value: string): boolean {
  return DECISION_WORDS.test(value);
}

// Defence in depth only: the primary controls are the enumerated task kinds, advisory-only
// response envelope, and CHECK constraints on the audit table. Phrase matching on normalised text.
const SUBJECTS = ['application', 'request', 'claim', 'case', 'appeal'];
const LINKS = ['is', 'has been', 'was', 'stands'];
const DECISIONS = ['approved', 'rejected', 'sanctioned', 'denied', 'granted'];
const ADDRESSEES = ['applicant', 'citizen', 'you'];
const STANDINGS = ['eligible', 'entitled', 'not eligible', 'not entitled'];
const HEREBY_VERBS = ['approve', 'reject', 'sanction', 'grant', 'deny'];
const FINAL_DECISIONS = [
  'final decision',
  'final eligibility decision',
  'final approval decision',
  'final rejection decision',
];

function normalise(text: string): string {
  const lettersOnly = text.toLowerCase().replace(/[^a-z]+/g, ' ');
  return ` ${lettersOnly.trim()} `;
}

export function assertsBindingDecision(text: string): boolean {
  const n = normalise(text);
  const has = (phrase: string): boolean => n.includes(` ${phrase} `);
  for (const subject of SUBJECTS) {
    for (const link of LINKS) {
      for (const decision of DECISIONS) {
        if (has(`${subject} ${link} ${decision}`) || has(`${subject} ${link} hereby ${decision}`)) {
          return true;
        }
      }
    }
  }
  for (const addressee of ADDRESSEES) {
    for (const link of ['is', 'are']) {
      for (const standing of STANDINGS) {
        if (
          has(`${addressee} ${link} ${standing}`) ||
          has(`${addressee} ${link} hereby ${standing}`)
        ) {
          return true;
        }
      }
    }
  }
  return HEREBY_VERBS.some((v) => has(`hereby ${v}`)) || FINAL_DECISIONS.some(has);
}
