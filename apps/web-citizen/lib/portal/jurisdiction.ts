import {
  applyJurisdictionScopeToFormSchema,
  validateFormDataAgainstJurisdictionScope,
  type FormPackage,
  type FormSchemaNode,
  type JurisdictionScope,
} from '@serviceform/service-templates';
import { resolveTenantJurisdictionScope } from '@serviceform/service-templates/sample-lab-dummy-resolve';
import { portalPlacement } from './platform';

/** Resolve tenant jurisdiction scope for any catalogue offering in this portal. */
export function offeringJurisdictionScope(catalogueId: string): JurisdictionScope {
  const placement = portalPlacement();
  return resolveTenantJurisdictionScope({
    catalogueId,
    tenantId: placement.tenant_id ?? null,
    environmentLabel: placement.environment_label ?? null,
  });
}

/** Clone form package with state/district enums constrained to tenant scope. */
export function formPackageWithJurisdictionScope(
  form: FormPackage,
  scope: JurisdictionScope,
): FormPackage {
  return {
    ...form,
    json_schema: applyJurisdictionScopeToFormSchema(form.json_schema, scope),
  };
}

export function jurisdictionRefusal(
  schema: FormSchemaNode,
  data: Record<string, unknown>,
  scope: JurisdictionScope,
): { field: string; message: string } | null {
  const issues = validateFormDataAgainstJurisdictionScope(schema, data, scope);
  const first = issues[0];
  if (!first) return null;
  return {
    field: first.pointer.slice(1).replaceAll('/', '.'),
    message: first.message,
  };
}
