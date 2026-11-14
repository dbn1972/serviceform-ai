import { catalogueIdForFormVersion } from '@serviceform/service-templates';
import type { PlatformApplication } from './applications';
import { offeringForBinding } from './platform';

/**
 * Resolve the catalogue id for a CMP-015 case without hard-coding IND-SOC-002 (CCR-M11-001).
 * Prefer the placement offering for the pinned binding; fall back to the catalogue form version.
 */
export function catalogueIdForCase(
  app: Pick<PlatformApplication, 'pins'> | { pins?: PlatformApplication['pins'] },
  fallback = 'IND-SOC-002',
): string {
  const pins = app.pins;
  if (!pins) return fallback;
  const byBinding = offeringForBinding(pins.tenant_service_binding_id);
  if (byBinding) return byBinding.catalogue_id;
  return catalogueIdForFormVersion(pins.form_version_id) ?? fallback;
}
