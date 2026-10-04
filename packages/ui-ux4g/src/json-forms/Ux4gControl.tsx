import type { ChangeEvent, SelectHTMLAttributes } from 'react';
import { TextInput } from '../components/TextInput';
import { Checkbox } from '../components/Checkbox';
import { Alert, RadioGroup } from '../components/Feedback';
import { resolveUx4gRenderer, type JsonSchemaNode, type UiSchemaHint } from './registry';

export type JsonFormsValue = string | number | boolean | undefined;

export type Ux4gControlProps = {
  schema: JsonSchemaNode;
  ui?: UiSchemaHint;
  id: string;
  name: string;
  value: JsonFormsValue;
  required?: boolean;
  onChange: (value: JsonFormsValue) => void;
};

export function Ux4gControl({ schema, ui, id, name, value, required, onChange }: Ux4gControlProps) {
  const renderer = resolveUx4gRenderer(schema, ui);
  const label = schema.title ?? name;
  if (renderer === 'Ux4gUnsupported') {
    return (
      <Alert variant="warning" title="Unsupported control">
        No UX4G renderer is registered for this schema node.
      </Alert>
    );
  }
  if (renderer === 'Ux4gCheckbox') {
    return (
      <Checkbox
        id={id}
        name={name}
        label={label}
        required={required}
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (renderer === 'Ux4gRadioGroup' && schema.enum) {
    return (
      <RadioGroup
        name={name}
        legend={label}
        options={schema.enum.map((item) => ({ value: String(item), label: String(item) }))}
        onChange={(next) => onChange(next)}
        {...(value === undefined ? {} : { value: String(value) })}
      />
    );
  }
  if (renderer === 'Ux4gSelect' && schema.enum) {
    const selectProps: SelectHTMLAttributes<HTMLSelectElement> = {
      id,
      name,
      required,
      value: value === undefined ? '' : String(value),
      onChange: (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value),
    };
    return (
      <div className="ux4g-input-container ux4g-input-m">
        <label className="ux4g-label-m-default" htmlFor={id}>
          {label}
        </label>
        <select className="ux4g-input-input" {...selectProps}>
          <option value="">Select</option>
          {schema.enum.map((item) => (
            <option key={String(item)} value={String(item)}>
              {String(item)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (renderer === 'Ux4gTextarea') {
    return (
      <div className="ux4g-input-container ux4g-input-m">
        <label className="ux4g-label-m-default" htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          name={name}
          required={required}
          className="ux4g-input-input"
          value={value === undefined || typeof value === 'boolean' ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  const type =
    renderer === 'Ux4gNumberInput' ? 'number' : renderer === 'Ux4gDateInput' ? 'date' : 'text';
  return (
    <TextInput
      id={id}
      name={name}
      label={label}
      required={required}
      type={type}
      value={value === undefined || typeof value === 'boolean' ? '' : String(value)}
      onChange={(e) =>
        onChange(renderer === 'Ux4gNumberInput' ? Number(e.target.value) : e.target.value)
      }
    />
  );
}
