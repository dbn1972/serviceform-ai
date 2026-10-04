import type { JsonSchemaNode } from './schema.js';
import {
  evaluateVisibility,
  scopeToField,
  scopeToPointer,
  walkControls,
  type UiNode,
} from './ui-schema.js';
import {
  accessibilityContract,
  resolveUx4gRenderer,
  schemaNodeAt,
  type Ux4gRendererId,
} from './ux4g.js';
import type { SchemaIssue } from './schema.js';
import { validateAgainstSchema } from './schema.js';

export interface ControlView {
  scope: string;
  field: string;
  visible: boolean;
  enabled: boolean;
  required: boolean;
  renderer_id: Ux4gRendererId;
  accessibility: ReturnType<typeof accessibilityContract>;
  label_key?: string;
  label?: string;
}

export interface RuntimeResult {
  visibleScopes: string[];
  requiredFields: string[];
  rendererIds: Ux4gRendererId[];
  controls: ControlView[];
  issues: SchemaIssue[];
  valid: boolean;
}

function schemaRequired(root: JsonSchemaNode, data: unknown): Set<string> {
  const names = new Set<string>(root.required ?? []);
  if (root.if) {
    const rec = data as Record<string, unknown>;
    const props = root.if.properties ?? {};
    const matched = Object.entries(props).every(([k, child]) => {
      if (child.const !== undefined) return rec[k] === child.const;
      if (child.enum) return child.enum.includes(rec[k]);
      return rec[k] !== undefined;
    });
    const branch = matched ? root.then : root.else;
    for (const n of branch?.required ?? []) names.add(n);
  }
  return names;
}

export function runFormRuntime(
  jsonSchema: JsonSchemaNode,
  uiSchema: UiNode,
  data: Record<string, unknown>,
  labels: Record<string, string>,
): RuntimeResult {
  const { visible, enabled } = evaluateVisibility(uiSchema, data);
  const requiredNames = schemaRequired(jsonSchema, data);
  const hiddenPointers = new Set<string>();
  walkControls(uiSchema, (node) => {
    if (node.scope && !visible.has(node.scope)) hiddenPointers.add(scopeToPointer(node.scope));
  });
  const controls: ControlView[] = [];
  const requiredFields: string[] = [];
  const rendererIds: Ux4gRendererId[] = [];
  walkControls(uiSchema, (node) => {
    if (!node.scope) return;
    const schema = schemaNodeAt(jsonSchema, node.scope) ?? {};
    const field = scopeToField(node.scope);
    const isVisible = visible.has(node.scope);
    const isRequired = isVisible && requiredNames.has(field);
    const hint: { control?: string; options?: { format?: string; multi?: boolean } } = {};
    if (node.options?.format) hint.control = node.options.format;
    if (node.options) hint.options = node.options;
    const renderer = resolveUx4gRenderer(schema, hint);
    rendererIds.push(renderer);
    if (isRequired) requiredFields.push(field);
    const labelKey = node.i18n;
    controls.push({
      scope: node.scope,
      field,
      visible: isVisible,
      enabled: enabled.has(node.scope),
      required: isRequired,
      renderer_id: renderer,
      accessibility: accessibilityContract(renderer, isRequired),
      ...(labelKey ? { label_key: labelKey, label: labels[labelKey] ?? labelKey } : {}),
      ...(!labelKey && schema.title ? { label: schema.title } : {}),
    });
  });
  const issues = validateAgainstSchema(jsonSchema, data, '', hiddenPointers);
  return {
    visibleScopes: [...visible].sort(),
    requiredFields: [...new Set(requiredFields)].sort(),
    rendererIds: [...new Set(rendererIds)].sort(),
    controls,
    issues,
    valid: issues.length === 0,
  };
}
