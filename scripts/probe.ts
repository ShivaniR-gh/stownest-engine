import { getDataset } from '../src/config/datasets';
import { readDataset } from '../api/_lib/sheets';

const ds = getDataset('leads')!;
readDataset(ds)
  .then(r => {
    console.log(`OK — ${r.rows.length} rows from "${ds.sheetName}"`);
    console.log('mapped:', Object.keys(r.rows[0] ?? {}).filter(k => !k.startsWith('__')).join(', '));
    console.log('in sheet but NOT in config:', r.unmappedSourceColumns.join(', ') || 'none');
  })
  .catch(e => console.error('FAILED —', e.message));
