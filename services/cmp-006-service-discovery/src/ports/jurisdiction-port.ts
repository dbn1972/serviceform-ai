/**
 * Master-data answer for one requested jurisdiction code. `applicable_codes` lists the code
 * itself plus every enclosing jurisdiction whose services apply there, as published by CMP-003.
 * CMP-006 never derives hierarchy itself.
 */
export interface JurisdictionResolution {
  code: string;
  active: boolean;
  applicable_codes: string[];
}

/** CMP-003 jurisdiction read port. Unknown codes are simply absent from the answer. */
export interface JurisdictionPort {
  resolve(input: { tenantId: string; codes: string[] }): Promise<JurisdictionResolution[]>;
}
