/**
 * CMP-005 profile signal port. Returns coarse, coded relevance signals only (never names,
 * identifiers, addresses or contact details). Called only after consent for the purpose.
 */
export interface ProfileSignalPort {
  signals(input: { tenantId: string; subjectId: string; purposeCode: string }): Promise<string[]>;
}
