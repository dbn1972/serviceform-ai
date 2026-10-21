import {
  isLabLanguage,
  normaliseMobile,
  registerLabAccount,
  validateLabRegistration,
  validateOtpCode,
  verifyLabOtp,
  type LabRegistrationInput,
} from '@serviceform/m10-sample-lab';
import {
  asString,
  labError,
  otpFailure,
  readJsonBody,
  sessionResponse,
} from '../../../../lib/lab-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXISTS_MESSAGE = 'An account already exists for this mobile number. Sign in instead.';

/**
 * Register: validate the synthetic profile first (so a typo does not burn the OTP), verify the
 * REGISTER challenge, then create the account and sign the citizen in.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (!body) return labError(400, 'SF-SYS-003', 'Request body must be a JSON object');
  const language = body['preferred_language'];
  const input: LabRegistrationInput = {
    display_name: asString(body['display_name']),
    mobile: asString(body['mobile']),
    email: asString(body['email']),
    preferred_language: isLabLanguage(language) ? language : 'en',
    consent: body['consent'] === true,
  };
  const field_errors = validateLabRegistration(input);
  if (Object.keys(field_errors).length > 0) {
    return labError(400, 'SF-SYS-003', 'Check the highlighted details', { field_errors });
  }
  const challenge_id = asString(body['challenge_id']);
  const code = asString(body['code']);
  const codeError = validateOtpCode(code);
  if (!challenge_id || codeError) {
    return labError(400, 'SF-SYS-003', codeError ?? 'challenge_id is required', { field: 'code' });
  }

  const verified = verifyLabOtp({ challenge_id, code, purpose: 'REGISTER' });
  if (!verified.ok) return otpFailure(verified.reason, verified.attempts_remaining);
  if (verified.challenge.mobile !== normaliseMobile(input.mobile)) {
    return labError(400, 'SF-SYS-003', 'The OTP was sent to a different mobile number', {
      field: 'mobile',
    });
  }

  const created = registerLabAccount({ ...input, mobile: verified.challenge.mobile });
  if (!created.ok) {
    return created.reason === 'EXISTS'
      ? labError(409, 'SF-LAB-ACCOUNT-EXISTS', EXISTS_MESSAGE)
      : labError(400, 'SF-SYS-003', 'Check the highlighted details', {
          field_errors: created.field_errors,
        });
  }
  return sessionResponse(created.account);
}
