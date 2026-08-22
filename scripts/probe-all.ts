import { DATASETS } from '../src/config/datasets';
import { readDataset } from '../api/_lib/sheets';

(async () => {
  let bad = 0;
  for (const ds of DATASETS) {
    try {
      const r = await readDataset(ds);
      const want = ds.columns.filter(c => c.sheetColumn).map(c => c.key);
      const got = new Set(Object.keys(r.rows[0] ?? {}));
      const miss = r.rows.length ? want.filter(k => !got.has(k)) : [];
      if (miss.length) bad++;
      console.log(
        `${miss.length ? 'FAIL' : 'ok  '}  ${ds.sheetName.padEnd(16)} ${String(r.rows.length).padStart(4)} rows` +
        (miss.length ? `  UNMATCHED: ${miss.join(', ')}` : '') +
        (r.unmappedSourceColumns.length ? `  extra in sheet: ${r.unmappedSourceColumns.join(', ')}` : ''));
    } catch (e) {
      bad++;
      console.log(`FAIL  ${ds.sheetName.padEnd(16)} ${(e as Error).message}`);
    }
  }
  console.log(bad === 0 ? '\nEvery tab maps cleanly.' : `\n${bad} tab(s) need attention.`);
})();
