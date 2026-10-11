export const RECOMMENDATION_STATUSES = [
  'REQUESTED',
  'GENERATED',
  'FAILED',
  'SELECTED',
  'DISMISSED',
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

const ALLOWED: Record<RecommendationStatus, readonly RecommendationStatus[]> = {
  REQUESTED: ['GENERATED', 'FAILED'],
  GENERATED: ['SELECTED', 'DISMISSED'],
  FAILED: [],
  SELECTED: [],
  DISMISSED: [],
};

export function canTransition(from: RecommendationStatus, to: RecommendationStatus): boolean {
  return ALLOWED[from].includes(to);
}

export const DISPOSITIONS = ['SELECTED', 'DISMISSED'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
