export const SECTION_CODES = ['IDENTITY', 'ADDRESS', 'FAMILY', 'OCCUPATION'] as const;
export type SectionCode = (typeof SECTION_CODES)[number];

export const CLAIM_CODES: Readonly<Record<SectionCode, readonly string[]>> = {
  IDENTITY: ['DISPLAY_NAME', 'GIVEN_NAME', 'FAMILY_NAME', 'CONTACT_EMAIL', 'CONTACT_PHONE'],
  ADDRESS: ['ADDRESS_LINE', 'LOCALITY', 'ADMIN_AREA', 'POSTAL_CODE', 'COUNTRY_CODE'],
  FAMILY: ['MEMBER_DISPLAY_NAME'],
  OCCUPATION: ['OCCUPATION_TITLE', 'EMPLOYER_NAME'],
};

export function isKnownClaim(section: string, code: string): boolean {
  if (!(SECTION_CODES as readonly string[]).includes(section)) return false;
  return (CLAIM_CODES[section as SectionCode] as readonly string[]).includes(code);
}
