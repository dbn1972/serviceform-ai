export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ISSUED';

export type DigiLockerPublishStatus = 'NOT_REQUESTED' | 'PUBLISHED' | 'FAILED';

export interface LabAddress {
  house_no_or_name: string;
  locality: string;
  post_office?: string;
  district: string;
  state_code: string;
  pincode: string;
}
