import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { IDS, hash, snapshotDigest, planChanges, compileRequests } from './corrections.mjs';
const quote=name=>`'${name.replace(/'/g,"''")}'`;
export async function readSnapshot(api,spreadsheetId) {
  const meta=await api.spreadsheets.get({spreadsheetId,fields:'sheets(properties(sheetId,title,gridProperties(columnCount)))'});
  const sheets=meta.data.sheets.map(s=>s.properties).filter(p=>Object.hasOwn(IDS,p.title)||p.title==='AUDIT_LOG');
  const data=await api.spreadsheets.values.batchGet({spreadsheetId,ranges:sheets.map(p=>`${quote(p.title)}!A:ZZ`),valueRenderOption:'FORMULA'});
  return Object.fromEntries(sheets.map((p,i)=>[p.title,{sheetId:p.sheetId,columnCount:p.gridProperties.columnCount,values:data.data.valueRanges[i].values||[]} ]));
}
function sign(payload,secret) {const s=Buffer.from(JSON.stringify(payload)).toString('base64url');return s+'.'+createHmac('sha256',secret).update(s).digest('hex');}
function verify(token,secret) {
  if(typeof token!=='string'||token.length>2048)throw new Error('Invalid preview token.');
  const [s,sig,...rest]=token.split('.'),mac=createHmac('sha256',secret).update(s||'').digest('hex');
  if(rest.length||typeof sig!=='string'||sig.length!==mac.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(mac)))throw new Error('Invalid preview token.');
  const payload=JSON.parse(Buffer.from(s,'base64url').toString());
  if(!Number.isFinite(payload.expires)||payload.expires<Date.now())throw new Error('Preview expired. Validate again.');
  return payload;
}
export async function handleCorrection({api,spreadsheetId,secret,body}) {
  if(!body||!['preview','apply'].includes(body.mode))return {status:400,body:{error:'Use mode: preview, then mode: apply with the signed preview token. Existing JSON arrays belong in entries.'}};
  try {
    const token=body.mode==='apply'?verify(body.token,secret):{seed:randomUUID(),expires:Date.now()+15*60*1000};
    if(body.mode==='apply'&&(token.entries!==hash(body.entries)||token.spreadsheet!==spreadsheetId))return {status:409,body:{error:'The entries or target changed. Validate again.'}};
    const snapshot=await readSnapshot(api,spreadsheetId),digest=snapshotDigest(snapshot);
    if(body.mode==='apply'&&token.snapshot!==digest)return {status:409,body:{error:'The spreadsheet changed after preview. Nothing was applied. Validate again.'}};
    const plan=planChanges(snapshot,body.entries,token.seed);
    const sessionId='correction_'+token.seed;
    const compiled=compileRequests(snapshot,plan,sessionId,new Date().toISOString());
    const summary=plan.operations.reduce((a,o)=>({...a,[o.action]:(a[o.action]||0)+1}),{});
    if(body.mode==='preview')return {status:200,body:{summary,operations:plan.operations,token:sign({...token,entries:hash(body.entries),snapshot:digest,spreadsheet:spreadsheetId},secret),expires:token.expires}};
    if(compiled.requests.length)await api.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:compiled.requests}});
    return {status:200,body:{sessionId,summary,applied:compiled.audit.length,operations:plan.operations,rollback:plan.operations.flatMap(o=>{
      if(o.action==='update'||o.action==='reassign')return [{entry_type:o.sheet,action:'update',record_id:o.id,changes:Object.fromEntries(o.changed.map(k=>[k,o.before[k]??''])),expected:o.after,reason:`Restore before ${sessionId}`}];
      if(o.action==='delete')return [{entry_type:o.sheet,action:'add',changes:o.before,reason:`Restore deleted relationship from ${sessionId}`}];
      return [];
    })}};
  }catch(e){return {status:400,body:{error:e.message||'Correction failed. Verify the audit log before retrying an uncertain network failure.'}};}
}
