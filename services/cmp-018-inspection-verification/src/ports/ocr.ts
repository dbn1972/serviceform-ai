/** INT-006: reuse M04 OCR (CMP-014) via port. Do not clone document intelligence. */
export interface OcrJobView {
  ocr_job_id: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
}

export interface OcrPort {
  lookup(tenantId: string, ocrJobId: string): Promise<OcrJobView>;
}
