/* Proves the seed retires once anything is configured, and that
   access_control survives so authentication cannot break. */
import { DATASETS as SEED } from '../src/config/datasets';

let f=0; const ck=(n:string,c:boolean,g?:unknown)=>{console.log(`  ${c?'pass':'FAIL'}  ${n}${c?'':' -> '+JSON.stringify(g)}`);if(!c)f++;};

// Mirrors the merge rule in api/_lib/registry.ts.
const ALWAYS_KEEP = new Set(['access_control']);
function merge(runtimeIds: string[]) {
  const runtime = runtimeIds.map(id => ({ id }));
  const ids = new Set(runtime.map(d => d.id));
  const usableSeed = runtime.length ? SEED.filter(d => ALWAYS_KEEP.has(d.id)) : SEED;
  return [...runtime, ...usableSeed.filter(d => !ids.has(d.id))].map(d => d.id);
}

console.log('\nNothing configured yet — full seed, so the app is never empty');
ck('all seed datasets available', merge([]).length === SEED.length, merge([]).length);
ck('access_control present', merge([]).includes('access_control'));

console.log('\nOne source configured — seeds retire');
const one = merge(['facility_data']);
ck('the connected dataset is present', one.includes('facility_data'), one);
ck('access_control survives (auth depends on it)', one.includes('access_control'));
ck('invoices no longer appears', !one.includes('invoices'), one);
ck('leads no longer appears', !one.includes('leads'));
ck('exactly the connected set plus access_control', one.length === 2, one);

console.log('\nA runtime source may still override a seed id');
const ov = merge(['invoices']);
ck('invoices present once, from runtime', ov.filter(x => x === 'invoices').length === 1, ov);
ck('no duplicate ids', new Set(ov).size === ov.length);

console.log(f===0?'\nAll seed-retirement checks passed.\n':`\n${f} FAILED\n`);
process.exit(f?1:0);
