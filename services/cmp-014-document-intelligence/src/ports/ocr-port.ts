import type { ConnectorMode, SimulationMarker } from '@serviceform/contracts';

export interface OcrInput {
  tenantId: string;
  documentId: string;
  checksumSha256: string;
  contentType: string;
  signal: AbortSignal;
}

export interface OcrOutcome {
  scenario: string;
  text: string;
  confidence: number;
  pageCount: number;
  simulation?: SimulationMarker;
}

/**
 * SIMULATED OCR connector (INT-013). REAL OCR requires a later connector ADR.
 * Must never call a vendor OCR or model SDK; inference goes through CMP-039.
 */
export interface OcrPort {
  readonly mode: ConnectorMode;
  readonly connectorBindingId: string;
  readonly simulation?: SimulationMarker;
  recognize(input: OcrInput): Promise<OcrOutcome>;
}
