'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import type { CompiledRules } from '@serviceform/studio-designers/rules';

function download(name: string, body: unknown) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The compiled GoRules JSON Decision Model (input → decision table → output) that CMP-008 runs,
 * and the CMP-033 RULES payload around it. The JDM opens in GoRules-compatible editors.
 */
export function RulesJdm({ compiled }: { compiled: CompiledRules | null }) {
  if (!compiled) return <p className="ux4g-body-m-default">Compiling…</p>;
  const { jdm } = compiled.pack;
  return (
    <div className="sf-designer-schema">
      <dl className="sf-dl">
        <dt>CMP-033 document key</dt>
        <dd>
          <code className="sf-hash">{compiled.documentKey}</code>
        </dd>
        <dt>content_hash (pin)</dt>
        <dd>
          <code className="sf-hash" data-testid="rules-content-hash">
            {compiled.contentHash}
          </code>
        </dd>
        <dt>Engine</dt>
        <dd>GORULES JDM on the CMP-008 ZEN engine · hit policy first · deterministic</dd>
        <dt>Hashed</dt>
        <dd>
          rule_pack_id, engine, jdm, outcome_field and reason_codes_field. Test cases and designer
          layout are stored beside the pack but are not part of the pin.
        </dd>
      </dl>
      <div className="sf-designer-row">
        <Button
          variant="outline-primary"
          size="s"
          onClick={() => download(`${compiled.pack.rule_pack_id}.jdm.json`, jdm)}
        >
          <Icon name="document" size={16} /> Download JDM
        </Button>
        <Button
          variant="outline-neutral"
          size="s"
          onClick={() => download(`${compiled.documentKey}.rules.json`, compiled.payload)}
        >
          <Icon name="code" size={16} /> Download CMP-033 payload
        </Button>
      </div>
      <div className="sf-designer-code-grid">
        <section className="sf-designer-code" aria-labelledby="rules-jdm-title">
          <h3 id="rules-jdm-title" className="ux4g-label-l-strong">
            JSON Decision Model (application/vnd.gorules.decision)
          </h3>
          <pre tabIndex={0} aria-label="JDM JSON">
            {JSON.stringify(jdm, null, 2)}
          </pre>
        </section>
        <section className="sf-designer-code" aria-labelledby="rules-cases-title">
          <h3 id="rules-cases-title" className="ux4g-label-l-strong">
            Test cases stored with the draft
          </h3>
          <pre tabIndex={0} aria-label="Test cases JSON">
            {JSON.stringify(compiled.payload.test_cases, null, 2)}
          </pre>
        </section>
      </div>
    </div>
  );
}
