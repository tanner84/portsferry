import test from 'node:test';
import assert from 'node:assert/strict';
import { planChanges, compileRequests } from '../netlify/functions/_shared/corrections.mjs';
import { handleCorrection } from '../netlify/functions/_shared/correction-service.mjs';
function table(sheetId,headers,rows=[]) {return {sheetId,columnCount:headers.length,values:[headers,...rows]};}
function fixture() {return {
 INDIVIDUALS:table(1,['ind_id','full_name','notes'],[['ind_060','Francis Triplett','keep'],['ind_065','Rev. John MacLeod','Cross Creek'],['ind_112','Major John James',''],['ind_089','John James II',''],['ind_146','Joshua James','']]),
 CHURCHES:table(2,['ch_id','name'],[['ch_008','Indiantown'],['ch_028','Barbecue']]),
 SOURCES:table(3,['src_id','title'],[['SRC_SMITH_2021','Smith']]),
 IND_CHURCH:table(4,['link_id','ind_id','ch_id','date_from','date_to','role','source_ids'],[['ich_040','ind_060','ch_008','1757','1781','Congregant',''],['ich_041','ind_065','ch_008','1757','','Elder',''],['ich_047','ind_089','ch_008','1757','','Community',''],['ich_032','ind_065','ch_028','1770','','Minister','']]),
 IND_IND:table(5,['edge_id','ind_id_a','ind_id_b','relationship','source_ids'],[['iind_243','ind_112','ind_146','kinship',''],['iind_002','ind_060','ind_065','unrelated','']]),
 PROPERTIES:table(6,['prop_id','name'],[['prop_a','Property']]),
 IND_PROPERTY:table(7,['ind_id','prop_id','date_from','relationship'],[['ind_060','prop_a','','Owner']]),
 AUDIT_LOG:table(8,['timestamp','session_id','entries_written','notes'])
};}
const corrections=[
 {entry_type:'IND_CHURCH',action:'reassign',record_id:'ich_040',changes:{ind_id:'ind_112',date_from:'1760',date_to:'',role:'Founder (circa 1760; Smith)',source_ids:'SRC_SMITH_2021'},reason:'Smith p. 71',expected:{ind_id:'ind_060'}},
 {entry_type:'IND_CHURCH',action:'delete',record_id:'ich_041',reason:'Wrong person'},
 {entry_type:'IND_CHURCH',action:'update',record_id:'ich_047',changes:{date_from:''},reason:'Birth year is not an admission date'},
 {entry_type:'IND_IND',action:'delete',record_id:'iind_243',reason:'Kinship not established'}
];
const plan=(s,e)=>planChanges(s,e,'fixed-seed');
function fakeAPI(initial) {
 let state=structuredClone(initial),writes=0;
 function apply(requests) {
  const next=structuredClone(state);
  const find=id=>Object.values(next).find(t=>t.sheetId===id);
  const decode=c=>c.userEnteredValue.stringValue??c.userEnteredValue.numberValue??c.userEnteredValue.boolValue;
  for(const r of requests) {
   if(r.updateCells) {const {start,rows}=r.updateCells,t=find(start.sheetId);rows.forEach((r,i)=>{t.values[start.rowIndex+i]??=[];r.values.forEach((v,j)=>{t.values[start.rowIndex+i][start.columnIndex+j]=decode(v);});});}
   if(r.appendCells){const t=find(r.appendCells.sheetId);t.values.push(...r.appendCells.rows.map(r=>r.values.map(decode)));}
   if(r.deleteDimension){const x=r.deleteDimension.range;find(x.sheetId).values.splice(x.startIndex,x.endIndex-x.startIndex);}
   if(r.appendDimension)find(r.appendDimension.sheetId).columnCount+=r.appendDimension.length;
  }
  state=next;writes++;
 }
 const api={spreadsheets:{
  get:async()=>({data:{sheets:Object.entries(state).map(([title,t])=>({properties:{title,sheetId:t.sheetId,gridProperties:{columnCount:t.columnCount}}}))}}),
  values:{batchGet:async({ranges})=>({data:{valueRanges:ranges.map(r=>({values:structuredClone(state[r.split("'")[1]].values)}))}})},
  batchUpdate:async({requestBody})=>apply(requestBody.requests)
 }};
 return {api,get state(){return state;},get writes(){return writes;},apply,edit(fn){fn(state);}};
}
async function preview(fake,entries) {return handleCorrection({api:fake.api,spreadsheetId:'test',secret:'secret',body:{mode:'preview',entries}});}
async function apply(fake,entries,token) {return handleCorrection({api:fake.api,spreadsheetId:'test',secret:'secret',body:{mode:'apply',entries,token}});}

test('real-world Indiantown reassign/delete/date clear keeps Cross Creek unchanged and audits originals',()=>{
 const s=fixture(),f=fakeAPI(s),p=plan(s,corrections);f.apply(compileRequests(s,p,'session','now').requests);
 assert.deepEqual(f.state.INDIVIDUALS,s.INDIVIDUALS);
 assert.equal(f.state.IND_CHURCH.values.length,4);
 assert.equal(f.state.IND_CHURCH.values[1][1],'ind_112');
 assert.equal(f.state.IND_CHURCH.values[2][3],'');
 assert.deepEqual(f.state.IND_CHURCH.values[3],s.IND_CHURCH.values[4]);
 assert.equal(f.state.IND_IND.values.length,2);
 const h=f.state.AUDIT_LOG.values[0],del=f.state.AUDIT_LOG.values.find(r=>r[h.indexOf('record_id')]==='ich_041');
 assert.equal(JSON.parse(del[h.indexOf('before_json')]).ind_id,'ind_065');
});
test('deletions use descending indices after updates',()=>{
 const s=fixture(),f=fakeAPI(s),entries=[...corrections,{entry_type:'IND_CHURCH',action:'delete',record_id:'ich_047',reason:'second delete'}];
 // A batch cannot both update and delete the same record.
 assert.throws(()=>plan(s,entries),/same row/);
 const e=[corrections[0],corrections[1],entries.at(-1)];f.apply(compileRequests(s,plan(s,e),'x','now').requests);
 assert.equal(f.state.IND_CHURCH.values[2][0],'ich_032');
});
test('migration adds missing IDs without changing any original values',()=>{
 const s=fixture(),f=fakeAPI(s),e=[{entry_type:'IND_PROPERTY',action:'migrate_ids',reason:'Stable IDs'}];
 const p=plan(s,e);f.apply(compileRequests(s,p,'x','now').requests);
 assert.deepEqual(f.state.IND_PROPERTY.values[1].slice(0,4),s.IND_PROPERTY.values[1]);
 assert.match(f.state.IND_PROPERTY.values[1][4],/^ip_[a-f0-9]{16}$/);
 assert.equal(plan(f.state,e).operations[0].rows.length,0);
 assert.deepEqual(f.state.IND_CHURCH,s.IND_CHURCH);
});
test('ID generation avoids holes, explicit IDs and multiple same-batch additions',()=>{
 const s=fixture();const e=[{entry_type:'IND_IND',ind_id_a:'ind_112',ind_id_b:'ind_089',relationship:'father'}, {entry_type:'IND_IND',ind_id_a:'ind_089',ind_id_b:'ind_146',relationship:'unverified'}];
 const p=plan(s,e),ids=p.operations.map(o=>o.id);assert.equal(new Set(ids).size,2);assert(!ids.includes('iind_002'));
 assert.throws(()=>plan(s,[e[0],e[0]]),/duplicate/);
});
test('legacy partial overwrite keeps other columns; no append for missing overwrite',()=>{
 const s=fixture();const p=plan(s,[{entry_type:'INDIVIDUALS',overwrite:true,ind_id:'ind_112',notes:'Checked'}]);
 assert.equal(p.operations[0].after.full_name,'Major John James');
 assert.throws(()=>plan(s,[{entry_type:'INDIVIDUALS',overwrite:true,ind_id:'ind_999',notes:'x'}]),/not found/);
 assert.equal(plan(s,[{entry_type:'INDIVIDUALS',ind_id:'ind_112'}]).operations[0].action,'skip');
});
test('unknown fields, unknown IDs, entity deletes, bad expected values and duplicate relationships fail',()=>{
 const s=fixture();
 for(const changes of [{ind_id:'ind_999'},{basin_id:'cape_fear'},{source_ids:'missing'}]) assert.throws(()=>plan(s,[{...corrections[0],changes}]));
 assert.throws(()=>plan(s,[{entry_type:'INDIVIDUALS',action:'delete',record_id:'ind_112',reason:'x'}]),/limited/);
 assert.throws(()=>plan(s,[{...corrections[0],expected:{ind_id:'ind_999'}}]),/no longer matches/);
 assert.throws(()=>plan(s,[{...corrections[0],changes:{ind_id:'ind_065',date_from:'1757'}}]),/duplicate/);
 assert.throws(()=>plan(s,[{...corrections[0],changes:{link_id:'ich_999'}}]),/Stable/);
});
test('references may point to entities added in the same batch',()=>{
 const e=[{entry_type:'IND_CHURCH',action:'add',changes:{ind_id:'ind_999',ch_id:'ch_008',date_from:'',role:'Member'},reason:'new'}, {entry_type:'INDIVIDUALS',action:'add',changes:{ind_id:'ind_999',full_name:'New'},reason:'new'}];
 assert.equal(plan(fixture(),e).operations.length,2);
});
test('server preview performs zero writes; apply rejects changed data, payloads and tampered tokens',async()=>{
 const f=fakeAPI(fixture()),p=await preview(f,corrections);assert.equal(p.status,200);assert.equal(f.writes,0);
 assert.equal((await apply(f,corrections,p.body.token+'x')).status,400);
 assert.equal((await apply(f,corrections.slice(0,1),p.body.token)).status,409);
 f.edit(s=>{s.INDIVIDUALS.values[1][2]='new finding';});
 assert.equal((await apply(f,corrections,p.body.token)).status,409);assert.equal(f.writes,0);
});
test('apply writes changes plus audit once, blocks replay and can restore deleted relationships',async()=>{
 const f=fakeAPI(fixture()),p=await preview(f,corrections),r=await apply(f,corrections,p.body.token);
 assert.equal(r.status,200);assert.equal(f.writes,1);assert.equal(r.body.applied,4);
 assert.equal((await apply(f,corrections,p.body.token)).status,409);
 const restore=r.body.rollback;const p2=await preview(f,restore);assert.equal(p2.status,200,JSON.stringify(p2));
 assert.equal((await apply(f,restore,p2.body.token)).status,200);
 const h=f.state.IND_CHURCH.values[0];assert(f.state.IND_CHURCH.values.slice(1).some(r=>r[h.indexOf('link_id')]==='ich_041'));
});
test('failed atomic batch does not report successful changes',async()=>{
 const f=fakeAPI(fixture()),p=await preview(f,corrections);
 f.api.spreadsheets.batchUpdate=async()=>{throw new Error('write denied');};
 const r=await apply(f,corrections,p.body.token);assert.equal(r.status,400);assert.equal(f.writes,0);assert.deepEqual(f.state,fixture());
});
