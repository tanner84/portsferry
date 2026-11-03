const validDate=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;};
exports.validateLocation=(r,partial=false)=>{
 const errors=[];
 if(!partial)for(const k of ['location_id','ind_id','place_id','date_from','source_ids','evidence_status'])if(!r[k])errors.push(`${k} required`);
 for(const k of ['date_from','date_to'])if(r[k]&&!validDate(r[k]))errors.push(`${k} must be a valid YYYY-MM-DD date`);
 if(r.date_to&&r.date_from&&r.date_to<r.date_from)errors.push('date_to precedes date_from');
 if(r.sequence!==undefined&&(!Number.isInteger(Number(r.sequence))||Number(r.sequence)<0))errors.push('sequence must be a nonnegative integer');
 if(r.evidence_status&&!['documented','inferred','proposed'].includes(r.evidence_status))errors.push('Invalid evidence_status');
 return errors;
};
