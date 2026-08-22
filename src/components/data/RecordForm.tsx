import { useMemo, useState } from 'react';
import type { DatasetDef, Row } from '@/config/types';
import { Button, Field, Modal } from '@/components/primitives';
import { toISODate, parseDate } from '@/lib/format';

/** Create/edit form generated from the dataset config. Only columns marked
 *  `editable` and mapped to a real sheet header can be written — everything
 *  else is read-only by construction, not by a hidden branch. */
export function RecordForm({
  dataset, record, onSubmit, onClose,
}: {
  dataset: DatasetDef;
  record?: Row | null;
  onSubmit: (values: Row) => Promise<void>;
  onClose: () => void;
}) {
  const fields = useMemo(
    () => dataset.columns.filter(c => c.sheetColumn && (c.editable || (!record && c.required))),
    [dataset, record],
  );

  const [values, setValues] = useState<Row>(() =>
    Object.fromEntries(fields.map(f => {
      const raw = record?.[f.key];
      if ((f.type === 'date' || f.type === 'datetime') && raw) {
        const d = parseDate(raw);
        return [f.key, d ? toISODate(d) : ''];
      }
      return [f.key, raw ?? ''];
    })));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const set = (k: string, v: unknown) => {
    setValues(s => ({ ...s, [k]: v }));
    setErrors(e => { const n = { ...e }; delete n[k]; return n; });
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    for (const f of fields) {
      const v = String(values[f.key] ?? '').trim();
      if (f.required && !v) e[f.key] = `${f.header} is required`;
      else if (v && (f.type === 'currency' || f.type === 'number') && Number.isNaN(Number(v.replace(/[₹,\s]/g, ''))))
        e[f.key] = 'Enter a number';
      else if (v && f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
        e[f.key] = 'Enter a valid email address';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true); setFailure(null);
    try { await onSubmit(values); onClose(); }
    catch (err) { setFailure(err instanceof Error ? err.message : 'The record could not be saved.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={record ? `Edit ${dataset.noun}` : `New ${dataset.noun}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : record ? 'Save changes' : `Add ${dataset.noun}`}
          </Button>
        </>
      }>
      {failure && (
        <div style={{
          marginBottom: 'var(--s4)', padding: 'var(--s3)', borderRadius: 'var(--r-md)',
          background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 'var(--fs-sm)',
        }}>{failure}</div>
      )}

      <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        {fields.map(f => (
          <div key={f.key} style={{ gridColumn: f.type === 'longtext' ? 'span 2' : undefined }}>
            <Field label={f.header + (f.required ? ' *' : '')} error={errors[f.key]} hint={f.help}>
              {f.type === 'enum' && f.enumValues ? (
                <select className={`field${errors[f.key] ? ' field--err' : ''}`}
                  value={String(values[f.key] ?? '')} onChange={e => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {f.enumValues.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : f.type === 'longtext' ? (
                <textarea className={`field${errors[f.key] ? ' field--err' : ''}`}
                  value={String(values[f.key] ?? '')} onChange={e => set(f.key, e.target.value)} />
              ) : (
                <input
                  className={`field${errors[f.key] ? ' field--err' : ''}`}
                  type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email'
                    : f.type === 'currency' || f.type === 'number' ? 'text' : 'text'}
                  inputMode={f.type === 'currency' || f.type === 'number' ? 'decimal' : undefined}
                  value={String(values[f.key] ?? '')}
                  onChange={e => set(f.key, e.target.value)}
                  placeholder={f.type === 'currency' ? '0' : ''} />
              )}
            </Field>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 'var(--s5)', fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', lineHeight: 1.6 }}>
        Writes straight to the <b>{dataset.sheetName}</b> tab. Your name and the timestamp are recorded
        on the audit tab.
      </p>
    </Modal>
  );
}
