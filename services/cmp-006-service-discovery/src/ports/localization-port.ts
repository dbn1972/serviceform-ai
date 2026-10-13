/** CMP-053 localization read port. Returns only the keys it can resolve for the locale. */
export interface LocalizationPort {
  resolveLabels(input: {
    tenantId: string;
    locale: string;
    keys: string[];
  }): Promise<Record<string, string>>;
}
