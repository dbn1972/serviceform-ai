export const DATA_CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export function isDataClassification(value: unknown): value is DataClassification {
  return typeof value === 'string' && (DATA_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function classificationRank(value: DataClassification): number {
  return DATA_CLASSIFICATIONS.indexOf(value);
}

export function exceeds(requested: DataClassification, ceiling: DataClassification): boolean {
  return classificationRank(requested) > classificationRank(ceiling);
}

/** PERSONAL and SENSITIVE data require a permitted purpose (consent/purpose check). */
export function requiresPurposeCheck(value: DataClassification): boolean {
  return classificationRank(value) >= classificationRank('PERSONAL');
}
