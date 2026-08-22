import { useNavigate } from 'react-router-dom';
import type { DatasetDef, Row } from '@/config/types';
import { Button, Modal } from '@/components/primitives';
import { DataTable } from './DataTable';
import { exportRows } from '@/lib/export';
import { Gate } from '@/lib/permissions/Gate';

/**
 * The bridge from a number back to the rows that produced it. Every chart and
 * KPI that can be drilled into opens this, so "why is that ₹4.2L?" is one
 * click, not a spreadsheet hunt.
 */
export function DrillDown({ title, subtitle, dataset, rows, onClose }: {
  title: string;
  subtitle?: string;
  dataset: DatasetDef;
  rows: Row[];
  onClose: () => void;
}) {
  const nav = useNavigate();
  const cols = dataset.columns.filter(c => c.sheetColumn);

  return (
    <Modal title={title} size="full" onClose={onClose}>
      {subtitle && (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', marginBottom: 'var(--s4)' }}>
          {subtitle}
        </div>
      )}
      <DataTable
        dataset={dataset}
        rows={rows}
        status="ready"
        error={null}
        onRowClick={r => { onClose(); nav(`/d/${dataset.department}/${dataset.id}/${encodeURIComponent(String(r.__id))}`); }}
        toolbarLeft={
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)' }}>
            <b className="num">{rows.length}</b> records behind this figure
          </span>
        }
        toolbarRight={
          <Gate action="EXPORT" department={dataset.department}>
            <Button size="sm" icon="download" onClick={() => exportRows(dataset.id, rows, cols)}>
              Export
            </Button>
          </Gate>
        }
      />
    </Modal>
  );
}
