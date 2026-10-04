import { AuditSinkUnavailableError } from './errors.js';

/** Fail-closed helper: a PRIVILEGED action must not proceed if audit write failed. */
export async function requireAudit<T>(
  actionClass: string,
  write: () => Promise<unknown>,
  act: () => Promise<T>,
): Promise<T> {
  try {
    await write();
  } catch (err) {
    if (actionClass === 'PRIVILEGED') {
      throw err instanceof AuditSinkUnavailableError
        ? err
        : new AuditSinkUnavailableError('Privileged action audit write failed');
    }
    throw err;
  }
  return act();
}
