import { getDatasetDef } from '../api/_lib/registry';
import { readDataset } from '../api/_lib/sheets';

async function main() {
  const ds = await getDatasetDef('collections_monthly');
  console.log('sheetName:', ds.sheetName, '| idColumn:', ds.idColumn);
  const { rows } = await readDataset(ds);
  console.log('rows:', rows.length);
  console.log(rows.slice(0, 3).map(r => ({ __id: r.__id, __row: r.__row, month: r.month })));
}
main().catch(e => { console.error(e); process.exit(1); });
