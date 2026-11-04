import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const batch=JSON.parse(readFileSync(new URL('../data/imports/st-james-santee-1916.json',import.meta.url)));
const people=batch.filter(x=>x.entry_type==='INDIVIDUALS');
const ids=new Set([...people.map(x=>x.ind_id),'ind_111']);
const sourceIds=new Set(batch.filter(x=>x.entry_type==='SOURCES').map(x=>x.src_id));
test('St James import validates in production admin and has unique composite keys',()=>{
 const ctx=vm.createContext({document:{addEventListener(){}}});
 vm.runInContext(readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8'),ctx);
 const keys=new Set();
 for(const entry of batch){
  ctx.entry=entry;
  const result=vm.runInContext('validateEntry(entry)',ctx);
  assert.equal(result.errors.length,0,JSON.stringify(result));assert.equal(result.warnings.length,0,JSON.stringify(result));
  const key=entry.entry_type+':'+(entry.entry_type==='IND_CHURCH'?`${entry.ind_id}:${entry.ch_id}:${entry.date_from}`:entry.entry_type==='IND_PROPERTY'?`${entry.ind_id}:${entry.prop_id}:${entry.date_from}`:entry.src_id||entry.edge_id||entry.ind_id||entry.ch_id||entry.prop_id);
  assert.ok(!keys.has(key),key);keys.add(key);
  for(const source of (entry.source_ids||'').split('|').filter(Boolean)) assert.ok(sourceIds.has(source),source);
 }
});
test('Parish links resolve; no surname-only military or residential claims',()=>{
 for(const r of batch){
  if(r.entry_type==='IND_CHURCH'){assert.ok(ids.has(r.ind_id));assert.equal(r.ch_id,'ch_st_james_santee');assert.ok(r.date_from<=r.date_to);}
  if(r.entry_type==='IND_IND'){assert.ok(ids.has(r.ind_id_a));assert.ok(ids.has(r.ind_id_b));}
 }
 assert.equal(people.length,42);
 for(const p of people){assert.equal(p.lat,'');assert.equal(p.lng,'');assert.equal(p.affiliation,'Unknown');}
 assert.ok(batch.some(r=>r.entry_type==='IND_IND'&&r.ind_id_b==='ind_111'));
 assert.ok(!batch.some(r=>r.entry_type==='IND_CHURCH'&&['ind_111','ind_116'].includes(r.ind_id)));
 assert.ok(!batch.some(r=>r.entry_type==='IND_PROPERTY'&&r.prop_id==='PROP_MOUZONS_HOUSE'));
});
