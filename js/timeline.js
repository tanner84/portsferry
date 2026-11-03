/* Calendar stepping with optional dated-person journey playback. */
window.PF=window.PF||{};
PF.timeline={currentDate:new Date(1770,0,1),resolution:'year',playing:false,_playTimer:null,
  start:new Date(1758,0,1),end:new Date(1783,11,31),journey:null};
PF.timeline.init=function(){
  const t=PF.timeline, slider=document.createElement('input');
  slider.type='range';slider.id='tl-range';slider.step=1;slider.setAttribute('aria-label','Timeline date');
  document.getElementById('tl-slider-container').appendChild(slider);t._slider=slider;
  slider.addEventListener('input',()=>t.setDate((()=>{const d=new Date(Number(slider.value)*86400000);return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());})()));
  document.getElementById('tl-play').addEventListener('click',t.play);
  document.getElementById('tl-pause').addEventListener('click',t.pause);
  document.getElementById('tl-step-back').addEventListener('click',()=>t.step(-1));
  document.getElementById('tl-step-fwd').addEventListener('click',()=>t.step(1));
  document.getElementById('tl-resolution').addEventListener('change',function(){t.resolution=this.value;t.setDate(t.currentDate);});
  t.setDate(t.currentDate);
};
PF.timeline.setDate=function(date,sequence=Infinity){
  const t=PF.timeline;t.sequence=sequence;if(!(date instanceof Date)||!Number.isFinite(+date))return;
  t.currentDate=new Date(Math.max(+t.start,Math.min(+t.end,+date)));
  if(t._slider){t._slider.min=Math.floor(Date.UTC(t.start.getFullYear(),t.start.getMonth(),t.start.getDate())/86400000);t._slider.max=Math.floor(Date.UTC(t.end.getFullYear(),t.end.getMonth(),t.end.getDate())/86400000);t._slider.value=Math.floor(Date.UTC(t.currentDate.getFullYear(),t.currentDate.getMonth(),t.currentDate.getDate())/86400000);}
  document.getElementById('tl-date-display').textContent=t.resolution==='year'&&!t.journey ? t.currentDate.getFullYear() : PF.movement.iso(t.currentDate);
  document.querySelectorAll('.tl-bound-label').forEach((el,i)=>el.textContent=t.journey?PF.movement.iso(i?t.end:t.start):(i?1783:1758));
  t._onDateChange(t.currentDate);
};
PF.timeline.setYear=year=>PF.timeline.setDate(new Date(year,0,1));
PF.timeline.step=function(delta){
  const t=PF.timeline,d=new Date(t.currentDate);
  if(t.resolution==='stop'&&t.journey){
    const day=PF.movement.iso(d), sequence=t.sequence ?? Infinity;
    const rows=PF.movement.sorted(t.journey.locations);
    const next=delta>0 ? rows.find(r=>r.date_from>day || (r.date_from===day && Number(r.sequence||0)>sequence))
      : rows.reverse().find(r=>r.date_from<day || (r.date_from===day && Number(r.sequence||0)<sequence));
    if(!next){t.pause();return;}t.setDate(PF.movement.parseDate(next.date_from),Number(next.sequence||0));return;
  }
  if(t.resolution==='day'||t.resolution==='stop')d.setDate(d.getDate()+delta);
  else if(t.resolution==='month'){const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+delta);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));}
  else {const month=d.getMonth();d.setFullYear(d.getFullYear()+delta);if(d.getMonth()!==month)d.setDate(0);}
  t.setDate(d);
};
PF.timeline.play=function(){const t=PF.timeline;if(t.playing)return;
  if(+t.currentDate>=+t.end)t.setDate(t.start);
  t.playing=true;document.getElementById('tl-play').classList.add('hidden');document.getElementById('tl-pause').classList.remove('hidden');
  t._playTimer=setInterval(()=>{if(t.resolution!=='stop' && +t.currentDate>=+t.end){t.pause();return;}t.step(1);},900);
};
PF.timeline.pause=function(){const t=PF.timeline;t.playing=false;clearInterval(t._playTimer);document.getElementById('tl-play').classList.remove('hidden');document.getElementById('tl-pause').classList.add('hidden');};
PF.timeline._onDateChange=function(date){
  if(!PF.data?.loaded)return;
  PF.map.renderIndividuals(PF.data.getIndividualsByDate(date));
  if(typeof PF.panels.onDateChange==='function')PF.panels.onDateChange(date);
  PF.journey?.render();
};
