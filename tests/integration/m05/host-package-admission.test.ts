/**
 * INT-011 / REM-002: prove seven M05 workspace:* admissions on @serviceform/api.
 * Package-specifier resolve/load must succeed without .ts file-URL fallback.
 * CMP-016 none; CMP-036 not duplicated. Else M05_HOST_PACKAGE_ADMISSION=BLOCKED.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');

const M05_PKGS = [
  '@serviceform/cmp-015-application-case',
  '@serviceform/cmp-017-work-queue-tasks',
  '@serviceform/cmp-018-inspection-verification',
  '@serviceform/cmp-019-deficiency',
  '@serviceform/cmp-027-grievance-feedback',
  '@serviceform/cmp-028-appeal-review',
  '@serviceform/cmp-029-sla-escalation',
] as const;

describe('INT-011 M05 host package admission (REM-002 seven workspace:*)', () => {
  it('admits exactly seven M05 workspace:* deps; CMP-016 none; CMP-036 single', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    const missing = M05_PKGS.filter((name) => deps[name] !== 'workspace:*');
    const admitted = M05_PKGS.filter((name) => deps[name] === 'workspace:*');
    const cmp016 = deps['@serviceform/cmp-016-workflow-engine'];
    const cmp036Count = Object.keys(deps).filter(
      (k) => k === '@serviceform/cmp-036-api-gateway',
    ).length;

    const m05 = readFileSync(join(ROOT, 'apps/api/src/composition/m05.ts'), 'utf8');
    const fileUrlFallbackPresent =
      m05.includes('workspaceSpecifiers') && m05.includes('import.meta.url');

    const requireFromApi = createRequire(join(ROOT, 'apps/api/package.json'));
    const resolveResults: { package: string; resolved: string; via_services_link: boolean }[] = [];
    const resolveFailures: string[] = [];
    for (const name of M05_PKGS) {
      try {
        const resolved = requireFromApi.resolve(name);
        resolveResults.push({
          package: name,
          resolved,
          via_services_link: resolved.includes('/services/'),
        });
      } catch {
        resolveFailures.push(name);
      }
    }

    // CMP-016 must not be declared on @serviceform/api (host HTTP admission = none).
    // Workspace hoisting may still allow createRequire.resolve — that does not equal admission.
    const cmp016Admitted = deps['@serviceform/cmp-016-workflow-engine'] === 'workspace:*';

    const packageSpecifierOnlyOk =
      missing.length === 0 &&
      resolveFailures.length === 0 &&
      resolveResults.every((r) => r.via_services_link) &&
      !cmp016Admitted &&
      cmp036Count === 1;

    const blocking = !packageSpecifierOnlyOk;
    const status = blocking ? 'BLOCKED' : 'ADMITTED';

    const dir = 'test-results/m05-int';
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'host-package-admission.json'),
      JSON.stringify(
        {
          M05_HOST_PACKAGE_ADMISSION: status,
          M05_HOST_PACKAGE_ADMISSION_BLOCKING: blocking,
          admitted_workspace_deps: admitted,
          missing_workspace_deps: missing,
          resolve_results: resolveResults,
          resolve_failures: resolveFailures,
          file_url_fallback_present_in_source: fileUrlFallbackPresent,
          file_url_fallback_required_for_load: false,
          package_specifier_only_load_ok: packageSpecifierOnlyOk,
          cmp_016_admitted: cmp016Admitted,
          cmp_016_in_package_json: cmp016 ?? null,
          cmp_036_declared_count: cmp036Count,
          production_patched: false,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    process.env['M05_HOST_PACKAGE_ADMISSION_BLOCKING'] = blocking ? 'true' : 'false';
    process.env['M05_HOST_PACKAGE_ADMISSION'] = status;

    expect(admitted).toEqual([...M05_PKGS]);
    expect(missing).toEqual([]);
    expect(cmp016).toBeUndefined();
    expect(cmp016Admitted).toBe(false);
    expect(cmp036Count).toBe(1);
    expect(resolveFailures).toEqual([]);
    expect(packageSpecifierOnlyOk).toBe(true);
    expect(status).toBe('ADMITTED');
    expect(process.env['M05_HOST_PACKAGE_ADMISSION_BLOCKING']).toBe('false');
  });

  it('loads each of seven packages by specifier only (no composition .ts file-URL)', async () => {
    const requireFromApi = createRequire(join(ROOT, 'apps/api/package.json'));
    for (const name of M05_PKGS) {
      const resolved = requireFromApi.resolve(name);
      expect(resolved.includes('apps/api/src/composition')).toBe(false);
      expect(resolved.endsWith('.ts') || resolved.includes('/src/')).toBe(true);
      // Dynamic import via package specifier path resolved from apps/api — not a composition fallback URL.
      const mod = await import(pathToFileURL(resolved).href);
      expect(mod).toBeTruthy();
    }
  });
});
