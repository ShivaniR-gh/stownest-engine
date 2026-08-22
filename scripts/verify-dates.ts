import { parseDate } from '../src/lib/format';
let f=0; const ck=(n:string,c:boolean,g?:unknown)=>{console.log(`  ${c?'pass':'FAIL'}  ${n}${c?'':' -> '+JSON.stringify(g)}`);if(!c)f++;};
const iso=(v:unknown)=>{const d=parseDate(v);return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:null;};
console.log('\nMonth-granularity values');
for (const [inp, want] of [['Jan 2026','2026-01-01'],['January 2026','2026-01-01'],['2026-01','2026-01-01'],
  ['Sep 2026','2026-09-01'],['September 2026','2026-09-01'],['Jan-26','2026-01-01'],['01/2026','2026-01-01'],
  ['2026 Mar','2026-03-01'],['Dec 2025','2025-12-01']] as [string,string][])
  ck(`"${inp}"`, iso(inp)===want, iso(inp));
console.log('\nExisting behaviour must not regress');
ck('dd/mm/yyyy still Indian order', iso('03/04/2025')==='2025-04-03', iso('03/04/2025'));
ck('ISO date unchanged', iso('2026-03-15')==='2026-03-15');
ck('Sheets serial unchanged', parseDate(45000)?.getFullYear()===2023);
ck('garbage still null', parseDate('not a date')===null);
ck('empty still null', parseDate('')===null);
ck('bare year resolves to 1 Jan (pre-existing Date.parse behaviour)', iso('2026')==='2026-01-01', iso('2026'));
console.log(f===0?'\nAll date checks passed.\n':`\n${f} FAILED\n`);process.exit(f?1:0);
