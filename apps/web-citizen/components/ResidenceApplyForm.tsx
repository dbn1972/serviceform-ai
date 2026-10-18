'use client';

import { Alert, Button, Card, RadioGroup, TextInput } from '@serviceform/ui-ux4g';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const EVIDENCE_OPTIONS = [
  { value: 'ELECTRICITY_BILL', label: 'Electricity bill' },
  { value: 'ROR_COPY', label: 'Record of Rights (RoR)' },
  { value: 'EPIC_OR_AADHAAR', label: 'EPIC or Aadhaar' },
  { value: 'RATION_CARD', label: 'Ration card' },
  { value: 'LEASE_AGREEMENT', label: 'Lease agreement' },
  { value: 'OTHER_RELEVANT', label: 'Other relevant evidence' },
] as const;

export function ResidenceApplyForm() {
  const router = useRouter();
  const [name, setName] = useState('SAMPLE LAB Applicant');
  const [dob, setDob] = useState('1990-01-15');
  const [gender, setGender] = useState('PREFER_NOT_TO_SAY');
  const [house, setHouse] = useState('SAMPLE Plot 1');
  const [locality, setLocality] = useState('SAMPLE Locality');
  const [district, setDistrict] = useState('SAMPLE District');
  const [pincode, setPincode] = useState('751001');
  const [months, setMonths] = useState('18');
  const [purpose, setPurpose] = useState('SAMPLE_LAB purpose — education');
  const [evidence, setEvidence] = useState<string>('ELECTRICITY_BILL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    const res = await fetch('/api/lab/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        applicant_name: name,
        applicant_dob: dob,
        applicant_gender: gender,
        residence_address: {
          house_no_or_name: house,
          locality,
          district,
          state_code: 'OD',
          pincode,
        },
        residence_duration_months: Number(months),
        purpose_of_certificate: purpose,
        evidence_type: evidence,
      }),
    });
    const body = (await res.json()) as {
      error_code?: string;
      application?: { id: string };
    };
    setBusy(false);
    if (!res.ok || !body.application) {
      setError(body.error_code ?? 'SF-LAB-SUBMIT');
      return;
    }
    router.push(`/certificates/${body.application.id}`);
  }

  return (
    <Card
      title="Application form"
      subtitle="Complete the details below. Fee is ₹0 for this sample service."
      footer={
        <div className="sf-actions">
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Submitting…' : 'Submit application (₹0)'}
          </Button>
        </div>
      }
    >
      <Alert variant="warning" title="Sample lab only — G6 not issued">
        Policy facts from the public e-District sample portal. DigiLocker stays SIMULATED /
        SAMPLE_LAB. Use synthetic values only — no real PII.
      </Alert>

      <div className="sf-meta-row" aria-label="Service policy summary">
        <span className="ux4g-tag-tonal-info">Eligibility ≥12 months</span>
        <span className="ux4g-tag-tonal-success">Fee ₹0</span>
        <span className="ux4g-tag-tonal-neutral">SLA 10 working days</span>
        <span className="ux4g-tag-outline-warning">DigiLocker SIMULATED</span>
      </div>

      <div className="sf-form-grid">
        <TextInput
          id="applicant_name"
          name="applicant_name"
          label="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextInput
          id="applicant_dob"
          name="applicant_dob"
          label="Date of birth"
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
        />
        <div className="sf-span-2">
          <RadioGroup
            name="applicant_gender"
            legend="Gender"
            value={gender}
            onChange={setGender}
            options={[
              { value: 'MALE', label: 'Male' },
              { value: 'FEMALE', label: 'Female' },
              { value: 'TRANSGENDER', label: 'Transgender' },
              { value: 'OTHER', label: 'Other' },
              { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
            ]}
          />
        </div>
        <TextInput
          id="house"
          name="house"
          label="House no / name"
          value={house}
          onChange={(e) => setHouse(e.target.value)}
        />
        <TextInput
          id="locality"
          name="locality"
          label="Locality / village / ward"
          value={locality}
          onChange={(e) => setLocality(e.target.value)}
        />
        <TextInput
          id="district"
          name="district"
          label="District"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
        />
        <TextInput
          id="pincode"
          name="pincode"
          label="PIN code"
          inputMode="numeric"
          value={pincode}
          onChange={(e) => setPincode(e.target.value)}
        />
        <TextInput
          id="months"
          name="months"
          label="Residence duration (months)"
          inputMode="numeric"
          value={months}
          onChange={(e) => setMonths(e.target.value)}
        />
        <TextInput
          id="purpose"
          name="purpose"
          label="Purpose of certificate"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
        <div className="sf-span-2">
          <label className="ux4g-label-m-strong" htmlFor="evidence">
            Evidence type
          </label>
          <select
            id="evidence"
            className="ux4g-input ux4g-input-input"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          >
            {EVIDENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <Alert variant="error" title="Submit failed">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
