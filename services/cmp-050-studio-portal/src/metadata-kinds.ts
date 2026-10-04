/** Generic metadata kinds (CMP-033 contract). No named-service branching. */
export const METADATA_KINDS = [
  'SERVICE',
  'OFFERING',
  'FORM',
  'RULES',
  'EVIDENCE',
  'FEE',
  'WORKFLOW',
  'SLA',
  'ACCESS',
  'CREDENTIAL',
  'NOTIFICATION',
] as const;

export type MetadataKind = (typeof METADATA_KINDS)[number];

export type FieldHint = {
  name: string;
  title: string;
  type: 'string' | 'integer' | 'boolean';
  enum?: readonly string[];
  control?: 'textarea' | 'radio';
  required: boolean;
};

export function isMetadataKind(value: string): value is MetadataKind {
  return (METADATA_KINDS as readonly string[]).includes(value);
}

export function fieldsForKind(kind: MetadataKind): readonly FieldHint[] {
  switch (kind) {
    case 'SERVICE':
      return [
        { name: 'code', title: 'Service code', type: 'string', required: true },
        { name: 'title', title: 'Title', type: 'string', required: true },
      ];
    case 'OFFERING':
      return [
        {
          name: 'service_document_key',
          title: 'Service document key',
          type: 'string',
          required: true,
        },
        {
          name: 'jurisdiction_scope',
          title: 'Jurisdiction scope',
          type: 'string',
          enum: ['PLATFORM', 'TENANT'],
          control: 'radio',
          required: true,
        },
      ];
    case 'FORM':
      return [
        {
          name: 'pages_json',
          title: 'Pages (JSON array)',
          type: 'string',
          control: 'textarea',
          required: true,
        },
      ];
    case 'RULES':
      return [
        { name: 'rule_pack_id', title: 'Rule pack id', type: 'string', required: true },
        { name: 'engine', title: 'Engine', type: 'string', enum: ['GORULES'], required: true },
      ];
    case 'EVIDENCE':
      return [
        {
          name: 'requirements_json',
          title: 'Requirements (JSON array)',
          type: 'string',
          control: 'textarea',
          required: true,
        },
      ];
    case 'FEE':
      return [
        {
          name: 'items_json',
          title: 'Fee items (JSON array)',
          type: 'string',
          control: 'textarea',
          required: true,
        },
      ];
    case 'WORKFLOW':
      return [
        {
          name: 'steps_json',
          title: 'Steps (JSON array)',
          type: 'string',
          control: 'textarea',
          required: true,
        },
      ];
    case 'SLA':
      return [
        {
          name: 'clocks_json',
          title: 'Clocks (JSON array)',
          type: 'string',
          control: 'textarea',
          required: true,
        },
      ];
    case 'ACCESS':
      return [
        {
          name: 'roles_json',
          title: 'Role codes (JSON array)',
          type: 'string',
          control: 'textarea',
          required: true,
        },
      ];
    case 'CREDENTIAL':
      return [{ name: 'template_key', title: 'Template key', type: 'string', required: true }];
    case 'NOTIFICATION':
      return [
        {
          name: 'templates_json',
          title: 'Templates (JSON array)',
          type: 'string',
          control: 'textarea',
          required: true,
        },
      ];
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function payloadFromFields(kind: MetadataKind, fields: Record<string, string>): unknown {
  const parseJson = (raw: string, fallback: unknown): unknown => {
    if (raw.trim().length === 0) return fallback;
    return JSON.parse(raw) as unknown;
  };
  switch (kind) {
    case 'SERVICE':
      return { code: fields['code'] ?? '', title: fields['title'] ?? '' };
    case 'OFFERING':
      return {
        service_document_key: fields['service_document_key'] ?? '',
        jurisdiction_scope: fields['jurisdiction_scope'] ?? 'TENANT',
      };
    case 'FORM':
      return { pages: parseJson(fields['pages_json'] ?? '', []) };
    case 'RULES':
      return { rule_pack_id: fields['rule_pack_id'] ?? '', engine: fields['engine'] ?? 'GORULES' };
    case 'EVIDENCE':
      return { requirements: parseJson(fields['requirements_json'] ?? '', []) };
    case 'FEE':
      return { items: parseJson(fields['items_json'] ?? '', []) };
    case 'WORKFLOW':
      return { steps: parseJson(fields['steps_json'] ?? '', []) };
    case 'SLA':
      return { clocks: parseJson(fields['clocks_json'] ?? '', []) };
    case 'ACCESS':
      return { roles: parseJson(fields['roles_json'] ?? '', []) };
    case 'CREDENTIAL':
      return { template_key: fields['template_key'] ?? '' };
    case 'NOTIFICATION':
      return { templates: parseJson(fields['templates_json'] ?? '', []) };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function defaultFieldValues(kind: MetadataKind): Record<string, string> {
  switch (kind) {
    case 'SERVICE':
      return { code: 'generic_service', title: 'Generic service' };
    case 'OFFERING':
      return { service_document_key: 'generic.service', jurisdiction_scope: 'TENANT' };
    case 'FORM':
      return {
        pages_json: JSON.stringify(
          [{ id: 'page.one', fields: [{ id: 'field.one', control: 'text' }] }],
          null,
          2,
        ),
      };
    case 'RULES':
      return { rule_pack_id: 'generic.rules', engine: 'GORULES' };
    case 'EVIDENCE':
      return {
        requirements_json: JSON.stringify([{ id: 'req.one', artifact_type: 'document' }], null, 2),
      };
    case 'FEE':
      return { items_json: JSON.stringify([{ id: 'fee.one', amount_minor: 0 }], null, 2) };
    case 'WORKFLOW':
      return { steps_json: JSON.stringify([{ id: 'step.one', type: 'TASK' }], null, 2) };
    case 'SLA':
      return { clocks_json: JSON.stringify([{ id: 'clock.one', duration_iso: 'P7D' }], null, 2) };
    case 'ACCESS':
      return { roles_json: JSON.stringify(['STUDIO_DESIGNER'], null, 2) };
    case 'CREDENTIAL':
      return { template_key: 'generic.credential' };
    case 'NOTIFICATION':
      return {
        templates_json: JSON.stringify([{ id: 'tpl.one', channel: 'EMAIL' }], null, 2),
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}
