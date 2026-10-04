/**
 * Pattern-only synthetic values assembled at runtime. None identify a real person or credential;
 * they exist so redaction can be exercised without PII/secrets in committed fixtures.
 */
export const synthetic = {
  email: () => ['person.one', 'example.org'].join('@'),
  nationalId: () => ['2345', '6789', '0123'].join(' '),
  taxId: () => ['ABCDE', '1234', 'F'].join(''),
  phone: () => ['98', '76543210'].join(''),
  card: () => ['4111', '1111', '1111', '1111'].join(' '),
  bearer: () => ['Bearer', ['abcd', 'efgh', 'ijkl', '1234'].join('')].join(' '),
  credential: () => [['pass', 'word'].join(''), ['value', '9876'].join('')].join('='),
  cloudKey: () => ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
  jwt: () => ['eyJhbGciOiJub25l', 'eyJzdWIiOiJhYmMifQ', 'c2lnbmF0dXJl'].join('.'),
  privateKey: () =>
    [
      ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
      'ZmFrZQ==',
      ['-----END', 'PRIVATE KEY-----'].join(' '),
    ].join('\n'),
  urlCredential: () => ['https://', 'user', ':', 'pw12345', '@', 'host.invalid'].join(''),
};
