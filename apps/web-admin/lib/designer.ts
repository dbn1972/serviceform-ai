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
  type: 'string';
  enum?: readonly string[];
  control?: 'textarea' | 'radio';
};

export function fieldsForKind(kind: MetadataKind): readonly FieldHint[] {
  switch (kind) {
    case 'SERVICE':
      return [
        { name: 'code', title: 'Service code', type: 'string' },
        { name: 'title', title: 'Title', type: 'string' },
      ];
    case 'OFFERING':
      return [
        { name: 'service_document_key', title: 'Service document key', type: 'string' },
        {
          name: 'jurisdiction_scope',
          title: 'Jurisdiction scope',
          type: 'string',
          enum: ['PLATFORM', 'TENANT'],
          control: 'radio',
        },
      ];
    case 'RULES':
      return [
        { name: 'rule_pack_id', title: 'Rule pack id', type: 'string' },
        { name: 'engine', title: 'Engine', type: 'string', enum: ['GORULES'] },
      ];
    case 'CREDENTIAL':
      return [{ name: 'template_key', title: 'Template key', type: 'string' }];
    case 'FORM':
      return [
        { name: 'pages_json', title: 'Pages (JSON array)', type: 'string', control: 'textarea' },
      ];
    case 'EVIDENCE':
      return [
        {
          name: 'requirements_json',
          title: 'Requirements (JSON array)',
          type: 'string',
          control: 'textarea',
        },
      ];
    case 'FEE':
      return [
        {
          name: 'items_json',
          title: 'Fee items (JSON array)',
          type: 'string',
          control: 'textarea',
        },
      ];
    case 'WORKFLOW':
      return [
        { name: 'steps_json', title: 'Steps (JSON array)', type: 'string', control: 'textarea' },
      ];
    case 'SLA':
      return [
        { name: 'clocks_json', title: 'Clocks (JSON array)', type: 'string', control: 'textarea' },
      ];
    case 'ACCESS':
      return [
        {
          name: 'roles_json',
          title: 'Role codes (JSON array)',
          type: 'string',
          control: 'textarea',
        },
      ];
    case 'NOTIFICATION':
      return [
        {
          name: 'templates_json',
          title: 'Templates (JSON array)',
          type: 'string',
          control: 'textarea',
        },
      ];
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function payloadFromFields(kind: MetadataKind, fields: Record<string, string>): unknown {
  const parseJson = (raw: string): unknown => JSON.parse(raw.length === 0 ? '[]' : raw);
  switch (kind) {
    case 'SERVICE':
      return { code: fields['code'] ?? '', title: fields['title'] ?? '' };
    case 'OFFERING':
      return {
        service_document_key: fields['service_document_key'] ?? '',
        jurisdiction_scope: fields['jurisdiction_scope'] ?? 'TENANT',
      };
    case 'FORM':
      return { pages: parseJson(fields['pages_json'] ?? '[]') };
    case 'RULES':
      return { rule_pack_id: fields['rule_pack_id'] ?? '', engine: fields['engine'] ?? 'GORULES' };
    case 'EVIDENCE':
      return { requirements: parseJson(fields['requirements_json'] ?? '[]') };
    case 'FEE':
      return { items: parseJson(fields['items_json'] ?? '[]') };
    case 'WORKFLOW':
      return { steps: parseJson(fields['steps_json'] ?? '[]') };
    case 'SLA':
      return { clocks: parseJson(fields['clocks_json'] ?? '[]') };
    case 'ACCESS':
      return { roles: parseJson(fields['roles_json'] ?? '[]') };
    case 'CREDENTIAL':
      return { template_key: fields['template_key'] ?? '' };
    case 'NOTIFICATION':
      return { templates: parseJson(fields['templates_json'] ?? '[]') };
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
        pages_json: JSON.stringify([
          { id: 'page.one', fields: [{ id: 'field.one', control: 'text' }] },
        ]),
      };
    case 'RULES':
      return { rule_pack_id: 'generic.rules', engine: 'GORULES' };
    case 'EVIDENCE':
      return { requirements_json: JSON.stringify([{ id: 'req.one', artifact_type: 'document' }]) };
    case 'FEE':
      return { items_json: JSON.stringify([{ id: 'fee.one', amount_minor: 0 }]) };
    case 'WORKFLOW':
      return { steps_json: JSON.stringify([{ id: 'step.one', type: 'TASK' }]) };
    case 'SLA':
      return { clocks_json: JSON.stringify([{ id: 'clock.one', duration_iso: 'P7D' }]) };
    case 'ACCESS':
      return { roles_json: JSON.stringify(['STUDIO_DESIGNER']) };
    case 'CREDENTIAL':
      return { template_key: 'generic.credential' };
    case 'NOTIFICATION':
      return { templates_json: JSON.stringify([{ id: 'tpl.one', channel: 'EMAIL' }]) };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function makerCheckerUx(
  actorId: string,
  makerId: string,
  status: string,
  roles: readonly string[],
) {
  const isMaker = actorId === makerId;
  const hasChecker = roles.some(
    (r) => r === 'STUDIO_CHECKER' || r === 'TENANT_ADMIN' || r === 'PLATFORM_OPS',
  );
  const hasMaker = roles.some(
    (r) => r === 'STUDIO_DESIGNER' || r === 'TENANT_ADMIN' || r === 'PLATFORM_OPS',
  );
  if (status === 'DRAFT') {
    return { canSubmit: isMaker && hasMaker, canApprove: false, canReject: false };
  }
  if (status === 'SUBMITTED') {
    return {
      canSubmit: false,
      canApprove: !isMaker && hasChecker,
      canReject: !isMaker && hasChecker,
    };
  }
  return { canSubmit: false, canApprove: false, canReject: false };
}
