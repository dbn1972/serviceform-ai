// Static imports so the schemas travel with any bundle of this package (no runtime fs paths).
import auditEventSchema from '../../../contracts/shared/schemas/audit-event.schema.json' with { type: 'json' };
import authzDecisionSchema from '../../../contracts/shared/schemas/authz-decision.schema.json' with { type: 'json' };
import commonSchema from '../../../contracts/shared/schemas/common.schema.json' with { type: 'json' };
import connectorBindingSchema from '../../../contracts/shared/schemas/connector-binding.schema.json' with { type: 'json' };
import errorResponseSchema from '../../../contracts/shared/schemas/error-response.schema.json' with { type: 'json' };
import eventEnvelopeSchema from '../../../contracts/shared/schemas/event-envelope.schema.json' with { type: 'json' };
import idempotencyRecordSchema from '../../../contracts/shared/schemas/idempotency-record.schema.json' with { type: 'json' };
import isolationDeclarationSchema from '../../../contracts/shared/schemas/isolation-declaration.schema.json' with { type: 'json' };
import requestContextSchema from '../../../contracts/shared/schemas/request-context.schema.json' with { type: 'json' };
import simulationMarkerSchema from '../../../contracts/shared/schemas/simulation-marker.schema.json' with { type: 'json' };
import errorCatalogue from '../../../contracts/shared/error-catalogue.json' with { type: 'json' };

export const SCHEMAS: readonly object[] = [
  auditEventSchema,
  authzDecisionSchema,
  commonSchema,
  connectorBindingSchema,
  errorResponseSchema,
  eventEnvelopeSchema,
  idempotencyRecordSchema,
  isolationDeclarationSchema,
  requestContextSchema,
  simulationMarkerSchema,
];
export const ERROR_CATALOGUE_DOCUMENT = errorCatalogue;
