import { useState } from 'react';

interface TokenListInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string | undefined;
  hint?: string | undefined;
}

function normalizeValues(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  }
  return [...unique.values()];
}

export function TokenListInput({ label, values, onChange, placeholder, hint }: TokenListInputProps) {
  const [draft, setDraft] = useState('');

  function addDraftValue() {
    const nextValues = normalizeValues([
      ...values,
      ...draft.split(/[\n,]/g),
    ]);
    onChange(nextValues);
    setDraft('');
  }

  function removeValue(value: string) {
    onChange(values.filter((entry) => entry !== value));
  }

  return (
    <label className="field field--full">
      <span>{label}</span>
      {hint ? <small className="field__hint">{hint}</small> : null}
      <div className="token-list-input">
        <div className="token-list-input__chips">
          {values.length > 0 ? values.map((value) => (
            <button
              key={value}
              type="button"
              className="token-chip"
              onClick={() => removeValue(value)}
            >
              <span>{value}</span>
              <span aria-hidden="true">x</span>
            </button>
          )) : <p className="muted">No items added yet.</p>}
        </div>
        <div className="token-list-input__composer">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addDraftValue();
              }
            }}
            placeholder={placeholder ?? 'Type a value and press Enter'}
          />
          <button type="button" onClick={addDraftValue} disabled={draft.trim().length === 0}>
            Add
          </button>
        </div>
      </div>
    </label>
  );
}
