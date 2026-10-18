'use client';

import { Alert, Button, Card, RadioGroup, TextInput } from '@serviceform/ui-ux4g';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

/** Accepted types from published IND-SOC-002 evidence policy sample (fixtures). */
const EVIDENCE_OPTIONS = [
  { value: 'ELECTRICITY_BILL', label: 'Electricity bill' },
  { value: 'ROR_COPY', label: 'Copy of RoR' },
  { value: 'EPIC_OR_AADHAAR', label: 'EPIC / Aadhaar card' },
  { value: 'LANDLINE_TELEPHONE_BILL', label: 'Landline telephone bill' },
  { value: 'WATER_CONNECTION_BILL', label: 'Water connection bill' },
  { value: 'RATION_CARD', label: 'Ration card' },
  { value: 'HOLDING_TAX_RECEIPT', label: 'Holding tax receipt' },
  { value: 'LEASE_AGREEMENT', label: 'Lease agreement with house owner' },
  { value: 'EMPLOYER_CERTIFICATE', label: 'Certificate from the employer' },
  { value: 'BANK_PASSBOOK_FIRST_PAGE', label: 'First page of bank passbook' },
  { value: 'VOTER_LIST_EXTRACT', label: 'Extract of latest voter list' },
] as const;

const STEPS = [
  { id: 'applicant', label: 'Applicant', hint: 'Identity details' },
  { id: 'address', label: 'Residence', hint: 'Address & duration' },
  { id: 'evidence', label: 'Evidence', hint: 'Supporting document' },
  { id: 'preview', label: 'Preview', hint: 'Review & submit' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

const GENDER_LABEL: Record<string, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  TRANSGENDER: 'Transgender',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
};

function evidenceLabel(value: string): string {
  return EVIDENCE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function ResidenceApplyForm() {
  const router = useRouter();
  const [step, setStep] = useState<StepId>('applicant');

  // Applicant (form.schema.json)
  const [name, setName] = useState('SAMPLE LAB Applicant');
  const [dob, setDob] = useState('1990-01-15');
  const [gender, setGender] = useState('PREFER_NOT_TO_SAY');
  const [mobile, setMobile] = useState('9876543210');
  const [aadhaarLast4, setAadhaarLast4] = useState('4321');

  // Address
  const [house, setHouse] = useState('SAMPLE Plot 1');
  const [locality, setLocality] = useState('SAMPLE Locality');
  const [postOffice, setPostOffice] = useState('SAMPLE Post Office');
  const [district, setDistrict] = useState('SAMPLE District');
  const [stateCode, setStateCode] = useState('OD');
  const [pincode, setPincode] = useState('751001');
  const [months, setMonths] = useState('18');
  const [purpose, setPurpose] = useState(
    'SAMPLE_LAB purpose — education admission (synthetic only)',
  );

  // Evidence
  const [evidence, setEvidence] = useState<string>('ELECTRICITY_BILL');
  const [evidenceFile, setEvidenceFile] = useState('sample-electricity-bill.pdf');
  const [evidenceMime, setEvidenceMime] = useState('application/pdf');
  const [declaration, setDeclaration] = useState(false);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const monthsNum = Number(months);
  const eligibilityPass = Number.isFinite(monthsNum) && monthsNum >= 12;

  const validation = useMemo(() => {
    if (step === 'applicant') {
      if (!name.trim()) return 'Full name is required';
      if (!dob) return 'Date of birth is required';
      if (!gender) return 'Gender is required';
      if (mobile && !/^[0-9]{10}$/.test(mobile)) return 'Mobile must be 10 digits';
      if (aadhaarLast4 && !/^[0-9]{4}$/.test(aadhaarLast4)) return 'Aadhaar last 4 must be 4 digits';
    }
    if (step === 'address') {
      if (!house.trim() || !locality.trim() || !district.trim() || !stateCode.trim()) {
        return 'Complete the residence address';
      }
      if (!/^[0-9]{6}$/.test(pincode)) return 'PIN code must be 6 digits';
      if (!Number.isFinite(monthsNum) || monthsNum < 0) return 'Enter residence duration in months';
      if (!purpose.trim()) return 'Purpose is required';
    }
    if (step === 'evidence') {
      if (!evidence) return 'Select an evidence type';
      if (!evidenceFile.trim()) return 'Attach a SAMPLE_LAB evidence file name';
    }
    if (step === 'preview') {
      if (!declaration) return 'Confirm the declaration before submit';
      if (!eligibilityPass) return 'Eligibility requires ≥12 months residence (sample policy)';
    }
    return '';
  }, [
    step,
    name,
    dob,
    gender,
    mobile,
    aadhaarLast4,
    house,
    locality,
    district,
    stateCode,
    pincode,
    monthsNum,
    purpose,
    evidence,
    evidenceFile,
    declaration,
    eligibilityPass,
  ]);

  function goNext() {
    setError('');
    if (validation) {
      setError(validation);
      return;
    }
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.id);
  }

  function goBack() {
    setError('');
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev.id);
  }

  async function submit() {
    setError('');
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    const res = await fetch('/api/lab/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        applicant_name: name,
        applicant_dob: dob,
        applicant_gender: gender,
        applicant_mobile: mobile,
        applicant_aadhaar_last4: aadhaarLast4,
        residence_address: {
          house_no_or_name: house,
          locality,
          post_office: postOffice,
          district,
          state_code: stateCode,
          pincode,
        },
        residence_duration_months: monthsNum,
        purpose_of_certificate: purpose,
        evidence_type: evidence,
        evidence_file_name: evidenceFile,
        evidence_mime: evidenceMime,
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
    <div className="sf-wizard">
      <nav className="sf-stepper" aria-label="Application steps">
        <ol className="sf-stepper-list">
          {STEPS.map((s, i) => {
            const state =
              i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
            return (
              <li key={s.id} className={`sf-stepper-item sf-stepper-${state}`}>
                <button
                  type="button"
                  className="sf-stepper-btn"
                  aria-current={state === 'current' ? 'step' : undefined}
                  onClick={() => {
                    if (i <= stepIndex) {
                      setError('');
                      setStep(s.id);
                    }
                  }}
                >
                  <span className="sf-stepper-index" aria-hidden="true">
                    {i < stepIndex ? '✓' : i + 1}
                  </span>
                  <span className="sf-stepper-copy">
                    <span className="ux4g-label-m-strong">{s.label}</span>
                    <span className="ux4g-body-s-default">{s.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="sf-wizard-main">
        <Alert variant="warning" title="Sample lab only — G6 not issued">
          Fields follow the IND-SOC-002 form schema. DigiLocker stays SIMULATED. Use synthetic values
          only — no real PII.
        </Alert>

        <div className="sf-meta-row" aria-label="Service policy summary">
          <span className="ux4g-tag-tonal-info">Eligibility ≥12 months</span>
          <span className="ux4g-tag-tonal-success">Fee ₹0</span>
          <span className="ux4g-tag-tonal-neutral">SLA 10 working days</span>
          <span className="ux4g-tag-outline-warning">DigiLocker SIMULATED</span>
        </div>

        {step === 'applicant' ? (
          <Card title="1. Applicant details" subtitle="As per official record (form schema)">
            <div className="sf-form-section">
              <h3 className="ux4g-heading-s-strong">Identity</h3>
              <div className="sf-form-grid">
                <div className="sf-span-2">
                  <TextInput
                    id="applicant_name"
                    name="applicant_name"
                    label="Full name (as per official record)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <TextInput
                  id="applicant_dob"
                  name="applicant_dob"
                  label="Date of birth"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  required
                />
                <TextInput
                  id="applicant_mobile"
                  name="applicant_mobile"
                  label="Mobile number"
                  inputMode="numeric"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  hint="10 digits · synthetic only"
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
                  id="applicant_aadhaar_last4"
                  name="applicant_aadhaar_last4"
                  label="Last 4 digits of Aadhaar (verification only)"
                  inputMode="numeric"
                  value={aadhaarLast4}
                  onChange={(e) => setAadhaarLast4(e.target.value)}
                  hint="Masked · not full Aadhaar · SAMPLE_LAB"
                />
              </div>
            </div>
          </Card>
        ) : null}

        {step === 'address' ? (
          <Card title="2. Residence address" subtitle="Address where residence is claimed">
            <div className="sf-form-section">
              <h3 className="ux4g-heading-s-strong">Postal address</h3>
              <div className="sf-form-grid">
                <TextInput
                  id="house"
                  name="house"
                  label="House no / name"
                  value={house}
                  onChange={(e) => setHouse(e.target.value)}
                  required
                />
                <TextInput
                  id="locality"
                  name="locality"
                  label="Locality / village / ward"
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  required
                />
                <TextInput
                  id="post_office"
                  name="post_office"
                  label="Post office"
                  value={postOffice}
                  onChange={(e) => setPostOffice(e.target.value)}
                />
                <TextInput
                  id="district"
                  name="district"
                  label="District"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  required
                />
                <div>
                  <label className="ux4g-label-m-default" htmlFor="state_code">
                    State code
                  </label>
                  <select
                    id="state_code"
                    className="ux4g-input ux4g-input-input"
                    value={stateCode}
                    onChange={(e) => setStateCode(e.target.value)}
                  >
                    <option value="OD">OD</option>
                    <option value="XX">XX (other sample)</option>
                  </select>
                </div>
                <TextInput
                  id="pincode"
                  name="pincode"
                  label="PIN code"
                  inputMode="numeric"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="sf-form-section">
              <h3 className="ux4g-heading-s-strong">Residence claim</h3>
              <div className="sf-form-grid">
                <TextInput
                  id="months"
                  name="months"
                  label="Duration of residence at this address (months)"
                  inputMode="numeric"
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                  hint={
                    eligibilityPass
                      ? 'Meets ≥12 months sample eligibility'
                      : 'Sample eligibility requires ≥12 months'
                  }
                  required
                />
                <div className="sf-span-2">
                  <label className="ux4g-label-m-default" htmlFor="purpose">
                    Purpose for which certificate is required
                  </label>
                  <textarea
                    id="purpose"
                    className="ux4g-textarea"
                    rows={4}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {step === 'evidence' ? (
          <Card
            title="3. Supporting evidence"
            subtitle="At least one document from the published sample list"
          >
            <div className="sf-form-section">
              <h3 className="ux4g-heading-s-strong">Document type</h3>
              <label className="ux4g-label-m-default" htmlFor="evidence">
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
            <div className="sf-form-section">
              <h3 className="ux4g-heading-s-strong">Upload (SAMPLE_LAB mock)</h3>
              <p className="ux4g-body-m-default">
                Production stores binaries in object storage. This lab records a synthetic file
                reference only (PDF / JPEG / PNG, max 5&nbsp;MB per policy).
              </p>
              <div className="sf-form-grid">
                <TextInput
                  id="evidence_file"
                  name="evidence_file"
                  label="File name"
                  value={evidenceFile}
                  onChange={(e) => setEvidenceFile(e.target.value)}
                />
                <div>
                  <label className="ux4g-label-m-default" htmlFor="evidence_mime">
                    MIME type
                  </label>
                  <select
                    id="evidence_mime"
                    className="ux4g-input ux4g-input-input"
                    value={evidenceMime}
                    onChange={(e) => setEvidenceMime(e.target.value)}
                  >
                    <option value="application/pdf">application/pdf</option>
                    <option value="image/jpeg">image/jpeg</option>
                    <option value="image/png">image/png</option>
                  </select>
                </div>
              </div>
              <div className="sf-upload-mock" aria-hidden="true">
                <div className="sf-upload-icon">PDF</div>
                <div>
                  <p className="ux4g-label-m-strong">{evidenceFile}</p>
                  <p className="ux4g-body-s-default">
                    {evidenceLabel(evidence)} · {evidenceMime} · SAMPLE_LAB attachment
                  </p>
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {step === 'preview' ? (
          <Card
            title="4. Preview application"
            subtitle="Review every field before you submit — fee ₹0"
          >
            <Alert
              variant={eligibilityPass ? 'success' : 'error'}
              title={eligibilityPass ? 'Eligibility check: PASS' : 'Eligibility check: FAIL'}
            >
              Residence duration {monthsNum} months · sample rule ≥12 months · fee ₹0 · DigiLocker
              after officer issue (SIMULATED).
            </Alert>

            <div className="sf-preview-grid">
              <section className="sf-preview-block">
                <h3 className="ux4g-heading-s-strong">Applicant</h3>
                <dl className="sf-dl">
                  <dt>Full name</dt>
                  <dd>{name}</dd>
                  <dt>Date of birth</dt>
                  <dd>{dob}</dd>
                  <dt>Gender</dt>
                  <dd>{GENDER_LABEL[gender] ?? gender}</dd>
                  <dt>Mobile</dt>
                  <dd>{mobile || '—'}</dd>
                  <dt>Aadhaar (last 4)</dt>
                  <dd>{aadhaarLast4 ? `•••• ${aadhaarLast4}` : '—'}</dd>
                </dl>
              </section>

              <section className="sf-preview-block">
                <h3 className="ux4g-heading-s-strong">Residence</h3>
                <dl className="sf-dl">
                  <dt>House</dt>
                  <dd>{house}</dd>
                  <dt>Locality</dt>
                  <dd>{locality}</dd>
                  <dt>Post office</dt>
                  <dd>{postOffice || '—'}</dd>
                  <dt>District</dt>
                  <dd>{district}</dd>
                  <dt>State / PIN</dt>
                  <dd>
                    {stateCode} · {pincode}
                  </dd>
                  <dt>Duration</dt>
                  <dd>{monthsNum} months</dd>
                  <dt>Purpose</dt>
                  <dd>{purpose}</dd>
                </dl>
              </section>

              <section className="sf-preview-block sf-span-2">
                <h3 className="ux4g-heading-s-strong">Evidence</h3>
                <dl className="sf-dl">
                  <dt>Type</dt>
                  <dd>{evidenceLabel(evidence)}</dd>
                  <dt>File</dt>
                  <dd>
                    {evidenceFile} ({evidenceMime})
                  </dd>
                </dl>
              </section>
            </div>

            <label className="sf-declaration">
              <input
                type="checkbox"
                checked={declaration}
                onChange={(e) => setDeclaration(e.target.checked)}
              />
              <span className="ux4g-body-m-default">
                I declare that the particulars above are true for this SAMPLE_LAB application and
                that no real personal data has been entered.
              </span>
            </label>
          </Card>
        ) : null}

        {error ? (
          <Alert variant="error" title="Cannot continue">
            {error}
          </Alert>
        ) : null}

        <div className="sf-wizard-actions">
          {stepIndex > 0 ? (
            <Button variant="outline-neutral" onClick={goBack}>
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="sf-actions">
            {step !== 'preview' ? (
              <Button onClick={goNext}>Save &amp; continue</Button>
            ) : (
              <Button disabled={busy} onClick={() => void submit()}>
                {busy ? 'Submitting…' : 'Submit application (₹0)'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
