export interface ClassificationSuggestion {
  evidence_type_code: string;
  confidence: number;
}

/**
 * CMP-014 Document Intelligence, consumed through this port only. A suggestion is advisory: it can never
 * satisfy a requirement (no statutory decision by a model).
 */
export interface DocumentClassificationPort {
  suggest(input: {
    tenant_id: string;
    evidence_ref: string;
  }): Promise<ClassificationSuggestion | null>;
}
