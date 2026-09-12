import { createHash } from 'node:crypto';

export const IDS = {
  INDIVIDUALS:'ind_id', CHURCHES:'ch_id', PROPERTIES:'prop_id', UNITS:'unit_id', EVENTS:'evt_id', SOURCES:'src_id',
  BATTLES:'battle_id', UNIT_POSITIONS:'pos_id', BATTLE_PARTICIPANTS:'bp_id', IND_CHURCH:'link_id',
  IND_UNIT:'link_id', IND_PROPERTY:'link_id', IND_IND:'edge_id', EVT_LINKS:'link_id', WEATHER:'weather_id', COUNTIES:'county_id',
};
export const LINKS = {
  IND_CHURCH:['ind_id','ch_id','date_from'], IND_UNIT:['ind_id','unit_id','date_from'],
  IND_PROPERTY:['ind_id','prop_id','date_from'], IND_IND:['ind_id_a','ind_id_b','relationship'], EVT_LINKS:['evt_id','linked_id'],
};
const PREFIX = {IND_CHURCH:'ich',IND_UNIT:'iu',IND_PROPERTY:'ip',IND_IND:'iind',EVT_LINKS:'el'};
const REFS = {ind_id:'INDIVIDUALS',ind_id_a:'INDIVIDUALS',ind_id_b:'INDIVIDUALS',owner_id:'INDIVIDUALS',commander_id:'INDIVIDUALS',ch_id:'CHURCHES',prop_id:'PROPERTIES',unit_id:'UNITS',battle_id:'BATTLES',evt_id:'EVENTS'};
const META = new Set(['entry_type','overwrite','action','record_id','changes','expected','reason']);
const auditFields = ['timestamp','session_id','sheet','record_id','action','before_json','after_json','reason','source_ids'];
const str = v => v === undefined || v === null ? '' : String(v);
export const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function snapshotDigest(snapshot) { return hash(snapshot); }
function fail(message) { throw new Error(message); }
function object(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function tuple(row, fields) {return JSON.stringify(fields.map(k=>str(row[k])));}
function rows(table) {return table.values.slice(1).map((row,index)=>({index:index+1,data:Object.fromEntries(table.values[0].map((h,i)=>[h,row[i]??'']))})).filter(r=>Object.values(r.data).some(v=>str(v)!==''));}
function validTable(snapshot,name) {
  const t=snapshot[name]; if(!t) fail(`Missing sheet ${name}.`);
  const h=t.values[0]||[];
  if(!h.length || h.some(x=>typeof x!=='string'||!x||x!==x.trim()) || new Set(h).size!==h.length) fail(`${name}: blank, duplicate or whitespace-padded column headers must be corrected first.`);
  return t;
}
function allocate(seed,name,index,used) {
  let n=0,id;do { id=`${PREFIX[name]}_${hash([seed,name,index,n++]).slice(0,16)}`; }while(used.has(id));
  used.add(id);return id;
}

// Pure planner. It never writes and never mutates the snapshot.
export function planChanges(snapshot, entries, seed) {
  if(!Array.isArray(entries)||!entries.length||entries.length>500) fail('Provide an array of 1-500 entries.');
  const working={}, operations=[], touched=new Set(), migrations=new Set();
  for(const [name,t] of Object.entries(snapshot)) if(IDS[name]) working[name]=rows(validTable(snapshot,name));
  const originals=structuredClone(working);
  const seenIds={};
  function checkIds(name) {
    if(seenIds[name])return;
    const id=IDS[name],all=working[name].map(r=>str(r.data[id])).filter(Boolean);
    if(new Set(all).size!==all.length)fail(`${name}: duplicate ${id} values. Resolve them before editing this sheet.`);
    seenIds[name]=true;
  }
  entries.forEach((entry,i)=>{
    if(!object(entry)||!Object.hasOwn(IDS,entry.entry_type))fail(`Entry ${i+1}: invalid entry_type.`);
    const name=entry.entry_type,t=validTable(snapshot,name),headers=t.values[0],idField=IDS[name];checkIds(name);
    const action=entry.action||'legacy';
    if(!['legacy','add','update','reassign','delete','migrate_ids'].includes(action))fail(`Entry ${i+1}: unsupported action ${action}.`);
    if(action!=='legacy'&&!str(entry.reason).trim())fail(`Entry ${i+1}: include a reason for ${action}.`);
    if(action!=='legacy') for(const k of Object.keys(entry)) if(!META.has(k))fail(`Entry ${i+1}: put data fields inside changes; unexpected ${k}.`);
    if(migrations.has(name))fail(`${name}: ID migration must be the only operation on this sheet in a batch.`);
    if(action==='migrate_ids') {
      if(!PREFIX[name]||operations.some(o=>o.sheet===name))fail(`${name}: migrate IDs separately from record corrections.`);
      if(entry.changes||entry.record_id||entry.expected)fail('ID migration does not accept changes, record_id or expected.');
      migrations.add(name);
      const used=new Set(working[name].map(r=>str(r.data[idField])).filter(Boolean));
      const changes=working[name].filter(r=>!str(r.data[idField])).map((r,j)=>({index:r.index,before:structuredClone(r.data),after:{...r.data,[idField]:allocate(seed,name,j,used)}}));
      operations.push({sheet:name,action:'migrate_ids',id:idField,addHeader:!headers.includes(idField),rows:changes,reason:entry.reason});
      return;
    }
    const supplied=action==='legacy'?Object.fromEntries(Object.entries(entry).filter(([k])=>!META.has(k))):(entry.changes??{});
    if(!object(supplied))fail(`Entry ${i+1}: changes must be an object.`);
    if(action==='delete'&&Object.keys(supplied).length)fail('Delete cannot include changes.');
    if(action==='delete'&&!LINKS[name])fail('Deletion is limited to relationship rows. Person, church, property and source deletion is not supported.');
    const data={};
    for(const [k,v] of Object.entries(supplied)) {
      if(!headers.includes(k))fail(`${name}: unknown column ${k}. Add the column explicitly; it will not be silently discarded.`);
      if(v!==null&&!['string','number','boolean'].includes(typeof v))fail(`${name}.${k}: use a scalar value (pipe-delimit multiple source IDs).`);
      if(typeof v==='number'&&!Number.isFinite(v))fail(`${name}.${k}: invalid number.`);
      data[k]=v===null?'':v;
    }
    let target;
    const requested=entry.record_id??data[idField];
    if(requested!==undefined && str(requested)!=='') target=working[name].find(r=>str(r.data[idField])===str(requested));
    if(action==='legacy'&&!target&&LINKS[name]&&!data[idField]) {
      const fields=LINKS[name];
      if(name!=='IND_IND'&&fields.filter(f=>f!=='date_from').every(f=>str(data[f]))) {
        const matches=working[name].filter(r=>tuple(r.data,fields)===tuple(data,fields));
        if(matches.length>1)fail(`${name}: ambiguous legacy key; use record_id after migration.`);
        target=matches[0];
      }
    }
    if(['update','reassign','delete'].includes(action)) {
      if(!str(entry.record_id))fail(`${name}: ${action} requires record_id.`);
      if(!target)fail(`${name}: record ${entry.record_id} not found. No replacement row will be appended.`);
      if(!headers.includes(idField))fail(`${name}: migrate IDs first.`);
    }
    if(target?.index < 0)fail(`${name}: a newly added row cannot be targeted again in the same batch.`);
    if(action==='add'&&entry.record_id!==undefined)fail('Add uses changes, not record_id.');
    if(action==='add'&&target)fail(`${name}: ID already exists.`);
    if(entry.expected!==undefined) {
      if(!object(entry.expected)||!target)fail('Expected values require an existing target and an object.');
      for(const [k,v] of Object.entries(entry.expected)) if(!headers.includes(k)||str(target.data[k])!==str(v))fail(`${name}/${requested}: expected ${k} no longer matches. Refresh the record.`);
    }
    const overwrite=action==='legacy'&&entry.overwrite===true;
    if(action==='legacy'&&entry.overwrite!==undefined&&typeof entry.overwrite!=='boolean')fail('overwrite must be a boolean.');
    if(action==='legacy'&&target&&!overwrite) {operations.push({sheet:name,action:'skip',id:str(target.data[idField]),reason:'Existing record; overwrite not requested.'});return;}
    if(action==='legacy'&&overwrite&&!target)fail(`${name}: overwrite target not found; use add explicitly.`);
    if(target && Object.hasOwn(data,idField)&&str(data[idField])!==str(target.data[idField]))fail('Stable record IDs cannot be changed.');
    if(action==='reassign'&&!LINKS[name])fail('Reassign is limited to relationship rows.');
    const key=target?`${name}:${target.index}`:`${name}:new:${requested??i}`;
    if(touched.has(key))fail(`${name}: more than one operation targets the same row.`);
    touched.add(key);
    if(action==='delete') {
      operations.push({sheet:name,id:str(target.data[idField]),action:'delete',index:target.index,before:structuredClone(target.data),after:null,reason:entry.reason});
      working[name]=working[name].filter(r=>r!==target);return;
    }
    let after={...(target?target.data:Object.fromEntries(headers.map(h=>[h,'']))),...data};
    if(!target) {
      if(!str(after[idField])&&PREFIX[name]) {
        if(!headers.includes(idField))fail(`${name}: migrate IDs first, then add records.`);
        after[idField]=allocate(seed,name,i,new Set(working[name].map(r=>str(r.data[idField]))));
      }
      if(!str(after[idField]))fail(`${name}: missing ${idField}.`);
      if(!/^[A-Za-z0-9_-]+$/.test(str(after[idField])))fail(`${name}: invalid ID.`);
    }
    if(LINKS[name]) {
      const required=LINKS[name].filter(f=>f!=='date_from');
      for(const f of required)if(!str(after[f]))fail(`${name}: missing ${f}.`);
      if((!target || tuple(target.data,LINKS[name])!==tuple(after,LINKS[name])) && working[name].some(r=>r!==target&&tuple(r.data,LINKS[name])===tuple(after,LINKS[name])))fail(`${name}: correction would duplicate an existing relationship.`);
    }
    const changed=Object.keys(after).filter(k=>!target||after[k]!==target.data[k]);
    const op={sheet:name,id:str(after[idField]),action:target?(action==='reassign'?'reassign':'update'):'add',index:target?.index,before:target?structuredClone(target.data):null,after,changed,reason:entry.reason||'Legacy JSON import'};
    if(target)target.data=after;else working[name].push({index:-i-1,data:after});
    operations.push(op);
  });
  // Validate all changed references against the final batch state, allowing related adds in any order.
  for(const op of operations) {
    if(!op.after)continue;
    for(const k of op.changed) {
      const value=str(op.after[k]);
      if(k===IDS[op.sheet])continue;
      if(REFS[k]&&value&&!working[REFS[k]]?.some(r=>str(r.data[IDS[REFS[k]]])===value))fail(`${op.sheet}/${op.id}: ${k} refers to missing ${value}.`);
      if(k==='source_ids')for(const id of value.split('|').filter(Boolean))if(!working.SOURCES?.some(r=>str(r.data.src_id)===id))fail(`${op.sheet}/${op.id}: source ${id} is missing (use | between IDs).`);
    }
    if(op.sheet==='EVT_LINKS'&&(op.action==='add'||op.changed.some(k=>['linked_id','linked_type','entity_id','entity_type'].includes(k)))) {
      const id=str(op.after.linked_id||op.after.entity_id);
      const matches=Object.keys(IDS).filter(n=>!LINKS[n]&&working[n]?.some(r=>str(r.data[IDS[n]])===id));
      if(id&&matches.length!==1)fail(`EVT_LINKS/${op.id}: linked entity must resolve uniquely.`);
    }
  }
  // Explicit deletions never cascade; reject known references to deleted relationship IDs.
  for(const op of operations.filter(o=>o.action==='delete'))for(const [n,rs] of Object.entries(working))for(const r of rs) {
    for(const [k,v] of Object.entries(r.data))if((k.endsWith('_id')||k.endsWith('_ids'))&&k!==IDS[n]&&str(v).split('|').includes(op.id))fail(`${op.id} is still referenced by ${n}; remove that reference first.`);
  }
  return {operations,originals};
}
const cell=value=>({userEnteredValue:typeof value==='number'?{numberValue:value}:typeof value==='boolean'?{boolValue:value}:{stringValue:str(value)}});
const row=values=>({values:values.map(cell)});
function setCells(sheetId,rowIndex,columnIndex,values) {return {updateCells:{start:{sheetId,rowIndex,columnIndex},rows:[row(values)],fields:'userEnteredValue'}};}
export function compileRequests(snapshot, plan, sessionId, timestamp) {
  const requests=[],audit=[],deletes=[];
  const log=(op,before,after,id)=>{
    const record={timestamp,session_id:sessionId,sheet:op.sheet,record_id:id,action:op.action,before_json:JSON.stringify(before),after_json:JSON.stringify(after),reason:op.reason,source_ids:str(after?.source_ids||before?.source_ids)};
    if(Object.values(record).some(v=>str(v).length>45000))fail('A record exceeds the audit cell size limit. Split its content before editing.');audit.push(record);
  };
  for(const op of plan.operations) {
    const t=snapshot[op.sheet],h=t.values[0];
    if(op.action==='skip')continue;
    if(op.action==='migrate_ids') {
      const column=op.addHeader?h.length:h.indexOf(op.id);
      if(op.addHeader) {
        if(column>=t.columnCount)requests.push({appendDimension:{sheetId:t.sheetId,dimension:'COLUMNS',length:column+1-t.columnCount}});
        requests.push(setCells(t.sheetId,0,column,[op.id]));
        log(op,null,{column:op.id},'schema');
      }
      for(const r of op.rows){requests.push(setCells(t.sheetId,r.index,column,[r.after[op.id]]));log(op,r.before,r.after,r.after[op.id]);}
    } else if(op.action==='delete') {deletes.push({t,index:op.index});log(op,op.before,null,op.id);}
    else if(op.action==='add') {requests.push({appendCells:{sheetId:t.sheetId,rows:[row(h.map(k=>op.after[k]))],fields:'userEnteredValue'}});log(op,null,op.after,op.id);}
    else {for(const k of op.changed)requests.push(setCells(t.sheetId,op.index,h.indexOf(k),[op.after[k]]));log(op,op.before,op.after,op.id);}
  }
  // Existing row positions stay valid until all updates and appends have been emitted.
  deletes.sort((a,b)=>a.t.sheetId-b.t.sheetId||b.index-a.index).forEach(({t,index})=>requests.push({deleteDimension:{range:{sheetId:t.sheetId,dimension:'ROWS',startIndex:index,endIndex:index+1}}}));
  if(audit.length) {
    const t=validTable(snapshot,'AUDIT_LOG'),headers=[...t.values[0]],missing=auditFields.filter(k=>!headers.includes(k));
    headers.push(...missing);
    if(headers.length>t.columnCount)requests.push({appendDimension:{sheetId:t.sheetId,dimension:'COLUMNS',length:headers.length-t.columnCount}});
    if(missing.length)requests.push(setCells(t.sheetId,0,0,headers));
    requests.push({appendCells:{sheetId:t.sheetId,rows:audit.map(a=>row(headers.map(h=>a[h]??''))),fields:'userEnteredValue'}});
  }
  return {requests,audit};
}
