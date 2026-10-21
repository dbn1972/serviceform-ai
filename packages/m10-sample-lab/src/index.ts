export { PUBLIC_SAMPLE_LAB_POLICY } from './policy';
export type { DigiLockerMockMode } from './policy';
export type {
  ApplicationStatus,
  DigiLockerPublishStatus,
  LabAddress,
  LabApplication,
  LabCitizenAccount,
  LabIdentityStoreFile,
  LabOtpChallenge,
  LabOtpChallengeStatus,
  LabStoreFile,
} from './types';
export {
  labStorePath,
  readLabStore,
  writeLabStore,
  listApplications,
  getApplication,
  createApplication,
  updateApplication,
} from './store';
export { mockDigiLockerPublish } from './digilocker-mock';
export {
  LAB_SEED_ACCOUNT,
  LAB_SIMULATED_OTP_CODE,
  findLabAccount,
  identityStorePath,
  readIdentityStore,
  registerLabAccount,
  requestLabOtp,
  verifyLabOtp,
  type LabOtpFailureReason,
  type LabOtpRequestResult,
  type LabOtpVerifyResult,
  type LabRegistrationResult,
} from './identity';
export * from './identity-rules';
