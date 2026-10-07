/**
 * Host packaging residual (DEFERRED_UNRESOLVED from SF-M05-009).
 * Exercise host resolve path; if deployable package admission needs production changes
 * outside INT write set → M05_HOST_PACKAGE_ADMISSION_BLOCKING=true (do not patch).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('M05 host package admission residual', () => {
  it('records M05_HOST_PACKAGE_ADMISSION_BLOCKING when package.json lacks M05 workspace deps', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    const missing = M05_PKGS.filter((name) => deps[name] !== 'workspace:*');
    const m05 = readFileSync(join(ROOT, 'apps/api/src/composition/m05.ts'), 'utf8');
    const usesFileUrlFallback =
      m05.includes('workspaceSpecifiers') && m05.includes('import.meta.url');

    const blocking = missing.length > 0;
    const dir = 'test-results/m05-int';
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'host-package-admission.json'),
      JSON.stringify(
        {
          M05_HOST_PACKAGE_ADMISSION: blocking ? 'DEFERRED_UNRESOLVED' : 'ADMITTED',
          M05_HOST_PACKAGE_ADMISSION_BLOCKING: blocking,
          missing_workspace_deps: missing,
          file_url_fallback_present: usesFileUrlFallback,
          would_require_writes_outside_int_set: blocking
            ? ['apps/api/package.json', 'pnpm-lock.yaml']
            : [],
          production_patched: false,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    process.env['M05_HOST_PACKAGE_ADMISSION_BLOCKING'] = blocking ? 'true' : 'false';

    expect(usesFileUrlFallback).toBe(true);
    expect(blocking).toBe(true);
    expect(missing.length).toBe(M05_PKGS.length);
    expect(process.env['M05_HOST_PACKAGE_ADMISSION_BLOCKING']).toBe('true');
  });

  it('file-URL fallback still resolves CMP-015 index for host/build smoke', async () => {
    const href = new URL('../../../services/cmp-015-application-case/src/index.ts', import.meta.url)
      .href;
    const mod = (await import(href)) as { registerApplicationCaseRoutes?: unknown };
    expect(typeof mod.registerApplicationCaseRoutes).toBe('function');
  });
});
