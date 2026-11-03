/* Dated observations. Pure functions shared with the movement tests. */
(function(root) {
  const M = {};
  M.parseDate = function(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [y,m,d] = value.split('-').map(Number);
    const date = new Date(y,m-1,d);
    return date.getFullYear()===y && date.getMonth()===m-1 && date.getDate()===d ? date : null;
  };
  M.iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  M.sorted = rows => rows.filter(r => M.parseDate(r.date_from) && r.evidence_status !== 'proposed')
    .slice().sort((a,b)=>a.date_from.localeCompare(b.date_from) || Number(a.sequence||0)-Number(b.sequence||0) || a.location_id.localeCompare(b.location_id));
  M.at = function(rows, date, sequence=Infinity) {
    const day=M.iso(date), matches=M.sorted(rows).filter(r=>(r.date_from<day || (r.date_from===day && Number(r.sequence||0)<=sequence)));
    if (!matches.length) return null;
    const row=matches[matches.length-1];
    return {...row, last_known:day>(row.date_to || row.date_from)};
  };
  M.next = function(rows,date,direction) {
    const day=M.iso(date), dates=[...new Set(M.sorted(rows).map(r=>r.date_from))];
    return direction>0 ? dates.find(d=>d>day) : dates.reverse().find(d=>d<day);
  };
  M.coordinate = value => value!=='' && value!=null && Number.isFinite(Number(value)) ? Number(value) : null;
  if(typeof module!=='undefined') module.exports=M;
  root.PF=root.PF||{}; root.PF.movement=M;
})(typeof window!=='undefined'?window:globalThis);
