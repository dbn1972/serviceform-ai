import { validate, type SimulationMarker } from '@serviceform/contracts';
import { Cmp014Error, detail } from '../errors.js';
import type { OcrInput, OcrOutcome, OcrPort } from '../ports/ocr-port.js';

export type SimulatedOcrScenario =
  'success' | 'empty' | 'malformed' | 'unsupported' | 'low_confidence';

export interface SimulatedDocument {
  tenantId: string;
  documentId: string;
  checksumSha256: string;
  contentType: string;
  text: string;
  scenario: SimulatedOcrScenario;
}

export class SimulatedOcrAdapter implements OcrPort {
  readonly mode = 'SIMULATED' as const;
  readonly simulation: SimulationMarker;

  constructor(
    readonly connectorBindingId: string,
    private readonly docs: Map<string, SimulatedDocument>,
    environment: SimulationMarker['environment'],
  ) {
    const marker: SimulationMarker = {
      simulation: true,
      scenario: 'ocr_simulated',
      test_run_id: 'cmp-014-int-013',
      connector_binding_id: connectorBindingId,
      environment,
    };
    if (!validate('simulation-marker', marker).valid) {
      throw new Cmp014Error('SF-INT-001', detail('INVALID_SIMULATION_MARKER'));
    }
    this.simulation = marker;
  }

  private key(tenantId: string, documentId: string): string {
    return `${tenantId}:${documentId}`;
  }

  register(doc: SimulatedDocument): void {
    this.docs.set(this.key(doc.tenantId, doc.documentId), doc);
  }

  async recognize(input: OcrInput): Promise<OcrOutcome> {
    if (input.signal.aborted) throw new Cmp014Error('SF-AI-001', detail('OCR_ABORTED'));
    const doc = this.docs.get(this.key(input.tenantId, input.documentId));
    if (!doc || doc.checksumSha256 !== input.checksumSha256) {
      return {
        scenario: 'unsupported',
        text: '',
        confidence: 0,
        pageCount: 0,
        simulation: this.simulation,
      };
    }
    if (doc.scenario === 'empty') {
      return {
        scenario: 'empty',
        text: '',
        confidence: 0,
        pageCount: 1,
        simulation: this.simulation,
      };
    }
    if (doc.scenario === 'malformed') {
      return {
        scenario: 'malformed',
        text: '\u0000\u0001not-a-document',
        confidence: 0.05,
        pageCount: 1,
        simulation: this.simulation,
      };
    }
    if (doc.scenario === 'unsupported') {
      return {
        scenario: 'unsupported',
        text: '[UNSUPPORTED]',
        confidence: 0,
        pageCount: 1,
        simulation: this.simulation,
      };
    }
    const confidence = doc.scenario === 'low_confidence' ? 0.41 : 0.93;
    return {
      scenario: doc.scenario,
      text: doc.text,
      confidence,
      pageCount: 1,
      simulation: this.simulation,
    };
  }
}
