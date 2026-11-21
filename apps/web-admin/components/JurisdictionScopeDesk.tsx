'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';

/**
 * Reusable Admin control: set per-tenant allowed state / district / municipality
 * (ULB local-body) LGD codes for any catalogue offering.
 */
export function JurisdictionScopeDesk() {
  const [tenantId, setTenantId] = useState('0d15ba00-0001-4000-8000-0d15ba0000d1');
  const [catalogueId, setCatalogueId] = useState('IND-CIV-001');
  const [bindingId, setBindingId] = useState('');
  const [states, setStates] = useState(
    'LGD-S-01\nLGD-S-02\nLGD-S-03\nLGD-S-04\nLGD-S-05\nLGD-S-06\nLGD-S-07\nLGD-S-08\nLGD-S-09\nLGD-S-10',
  );
  const [districts, setDistricts] = useState(
    'LGD-D-0101\nLGD-D-0102\nLGD-D-0201\nLGD-D-0202\nLGD-D-0301\nLGD-D-0302\nLGD-D-0401\nLGD-D-0402\nLGD-D-0501\nLGD-D-0502',
  );
  const [municipalities, setMunicipalities] = useState(
    'LGD-U-010101\nLGD-U-010102\nLGD-U-020101\nLGD-U-020102\nLGD-U-030101\nLGD-U-030102\nLGD-U-040101\nLGD-U-040102\nLGD-U-050101\nLGD-U-050102',
  );
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    setError('');
    setStatus('');
    const q = new URLSearchParams({ tenant_id: tenantId, catalogue_id: catalogueId });
    const res = await fetch(`/api/lab/tenant-overlays?${q.toString()}`);
    const body = (await res.json()) as {
      error_code?: string;
      message?: string;
      overlay?: {
        tenant_service_binding_id?: string;
        jurisdiction?: {
          allowed_states?: string[];
          allowed_districts?: string[];
          allowed_municipalities?: string[];
        };
      };
      defaults?: {
        allowed_states?: string[];
        allowed_districts?: string[];
        allowed_municipalities?: string[];
      };
    };
    if (!res.ok) {
      setError(body.message ?? body.error_code ?? 'SF-SYS-004');
      return;
    }
    const jur = body.overlay?.jurisdiction ?? body.defaults;
    if (jur?.allowed_states) setStates(jur.allowed_states.join('\n'));
    if (jur?.allowed_districts) setDistricts(jur.allowed_districts.join('\n'));
    if (jur?.allowed_municipalities) setMunicipalities(jur.allowed_municipalities.join('\n'));
    if (body.overlay?.tenant_service_binding_id) {
      setBindingId(body.overlay.tenant_service_binding_id);
    }
    setStatus(
      body.overlay ? 'Loaded tenant overlay' : 'No overlay yet — showing SAMPLE_LAB defaults',
    );
  }

  async function save() {
    setError('');
    setStatus('');
    const res = await fetch('/api/lab/tenant-overlays', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        catalogue_id: catalogueId,
        tenant_service_binding_id: bindingId || undefined,
        environment_label: 'SAMPLE_LAB',
        jurisdiction: {
          allowed_states: states,
          allowed_districts: districts,
          allowed_municipalities: municipalities,
        },
      }),
    });
    const body = (await res.json()) as {
      error_code?: string;
      message?: string;
      overlay?: {
        jurisdiction?: {
          allowed_states?: string[];
          allowed_districts?: string[];
          allowed_municipalities?: string[];
        };
      };
    };
    if (!res.ok) {
      setError(body.message ?? body.error_code ?? 'SF-SYS-004');
      return;
    }
    const nStates = body.overlay?.jurisdiction?.allowed_states?.length ?? 0;
    const nDistricts = body.overlay?.jurisdiction?.allowed_districts?.length ?? 0;
    const nMunicipalities = body.overlay?.jurisdiction?.allowed_municipalities?.length ?? 0;
    setStatus(
      `Saved ${nStates} state / ${nDistricts} district / ${nMunicipalities} municipality LGD codes for ${catalogueId}`,
    );
  }

  return (
    <div>
      <p className="ux4g-body-m-default">
        Per-tenant scope for any catalogue offering (Certificate, Licence, Permit, Registration).
        Enter LGD codes for states, districts, and municipalities / ULBs — not place names. Forms
        only offer these codes. Empty lists fail closed outside SAMPLE_LAB.
      </p>
      <TextInput
        id="jur_tenant"
        name="jur_tenant"
        label="Tenant id"
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value)}
      />
      <TextInput
        id="jur_catalogue"
        name="jur_catalogue"
        label="Catalogue id (e.g. IND-CIV-001, IND-ULB-007)"
        value={catalogueId}
        onChange={(e) => setCatalogueId(e.target.value.toUpperCase())}
      />
      <TextInput
        id="jur_binding"
        name="jur_binding"
        label="TenantServiceBinding id (optional)"
        value={bindingId}
        onChange={(e) => setBindingId(e.target.value)}
        optional
      />
      <label className="ux4g-label" htmlFor="jur_states">
        Allowed states (LGD codes, one per line)
      </label>
      <textarea
        id="jur_states"
        name="jur_states"
        className="ux4g-textarea"
        rows={6}
        value={states}
        onChange={(e) => setStates(e.target.value)}
      />
      <label className="ux4g-label" htmlFor="jur_districts">
        Allowed districts (LGD codes, one per line)
      </label>
      <textarea
        id="jur_districts"
        name="jur_districts"
        className="ux4g-textarea"
        rows={6}
        value={districts}
        onChange={(e) => setDistricts(e.target.value)}
      />
      <label className="ux4g-label" htmlFor="jur_municipalities">
        Allowed municipalities / ULBs (LGD local-body codes, one per line)
      </label>
      <textarea
        id="jur_municipalities"
        name="jur_municipalities"
        className="ux4g-textarea"
        rows={6}
        value={municipalities}
        onChange={(e) => setMunicipalities(e.target.value)}
      />
      {error ? (
        <Alert variant="error" title="Jurisdiction scope failed">
          {error}
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="info" title="Jurisdiction scope">
          {status}
        </Alert>
      ) : null}
      <Button variant="outline-primary" onClick={() => void load()}>
        Load overlay
      </Button>
      <Button onClick={() => void save()}>Save overlay</Button>
    </div>
  );
}
