/* Opt-in, source-labelled Quincy case study; never writes to live Sheets. */
window.PF=window.PF||{};
PF.journey={};
PF.journey.init=async function(){
  const j=PF.journey;
  try{const r=await fetch('data/journeys/quincy-1773.json?v=20261103b');if(!r.ok)throw Error(r.status);j.example=await r.json();}
  catch(e){console.warn('Quincy journey unavailable',e);return;}
  const people=PF.data.raw.INDIVIDUALS||(PF.data.raw.INDIVIDUALS=[]);
  let person=people.find(p=>/josiah quincy/i.test(p.full_name||''));
  if(!person){person={ind_id:'quincy_1773',full_name:'Josiah Quincy Jr.',birth_year:'1744',death_year:'1775',affiliation:'Patriot',tier:'Exception',rank:'Lawyer and traveler',evidence_type:'Primary',lat:'',lng:'',source_ids:''};people.push(person);}
  j.personId=person.ind_id;
  j.layer=L.layerGroup().addTo(PF.map.instance);
};
PF.journey.toggle=function(){
  const j=PF.journey,t=PF.timeline;t.pause();
  if(t.journey){t.journey=null;j.layer.clearLayers();document.getElementById('journey-card').hidden=true;
    t.start=new Date(1758,0,1);t.end=new Date(1783,11,31);t.resolution='year';document.getElementById('tl-resolution').value='year';t.setYear(1770);j.syncControls();return;}
  t.journey=j.example;t.start=PF.movement.parseDate(j.example.start);t.end=PF.movement.parseDate(j.example.end);t.resolution='stop';
  document.getElementById('tl-resolution').value='stop';
  document.getElementById('journey-card').hidden=false;t.setDate(t.start,0);
  j.syncControls();
  PF.map.instance.fitBounds([[32.72,-80.0],[33.45,-79.2]],{padding:[45,45]});
};
PF.journey.render=function(){
  const j=PF.journey,t=PF.timeline;if(!t.journey||!j.layer)return;j.layer.clearLayers();
  const o=PF.movement.at(t.journey.locations,t.currentDate,t.sequence),card=document.getElementById('journey-card');card.replaceChildren();
  const heading=document.createElement('strong');heading.textContent='Josiah Quincy Jr. · 1773';card.append(heading);
  if(!o)return;
  const place=t.journey.places.find(p=>p.place_id===o.place_id);
  const status=document.createElement('p');status.textContent=`${o.last_known?'Last recorded stop':o.evidence_status==='inferred'?'Inferred identification':'Documented'}: ${o.date_from} · ${place.name}`;card.append(status);
  const note=document.createElement('p');note.textContent=o.notes+' '+place.notes;card.append(note);
  const a=document.createElement('a');a.href=t.journey.source.url;a.target='_blank';a.rel='noopener';a.textContent=`Source: ${o.source_page}`;card.append(a);
  const lat=PF.movement.coordinate(place.lat),lng=PF.movement.coordinate(place.lng);
  if(lat!==null&&lng!==null){
    L.circleMarker([lat,lng],{radius:9,color:'#fff',weight:2,fillColor:'#bc8338',fillOpacity:1}).addTo(j.layer).bindTooltip(status.textContent);
    if(Number(place.uncertainty_m)>0)L.circle([lat,lng],{radius:Number(place.uncertainty_m),color:'#bc8338',weight:1,dashArray:'5 5',fillOpacity:.05}).addTo(j.layer);
  }
};

PF.journey.syncControls=function(){
 const exit=document.getElementById('story-exit-journey');
 if(exit)exit.classList.toggle('hidden',!PF.timeline.journey);
};
