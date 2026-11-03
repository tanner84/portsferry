/* Sourced property supplement, independent of the Quincy itinerary. */
window.PF=window.PF||{};
PF.peachtree={init(){
 const raw=PF.data.raw;
 const add=(table,id,row)=>{const list=raw[table]||(raw[table]=[]);const existing=list.find(r=>r[id]===row[id]);if(!existing)list.push(row);return existing||row;};
 const source='src_peachtree_habs';
 add('SOURCES','src_id',{src_id:source,title:'Peachtree Plantation, HABS SC-882 (2014), pp. 1–3; Altizer, Three Hoes in the Kitchen (2014), pp. 2–5, 15–16',type:'Historic buildings survey / thesis',repository:'Library of Congress',url:'https://www.loc.gov/item/sc1199/',evidence_type:'Secondary'});
 const property=add('PROPERTIES','prop_id',{prop_id:'prop_peachtree_santee',name:'Peachtree Plantation',type:'Plantation house site',region:'Santee',location_accuracy:'Approximate house site',lat:'33.19047',lng:'-79.41236',date_from:'1738',date_to:'',acreage:'',plat_ref:'Altizer (2014), figures 3–4, pp. 4–5; HABS SC-882, p. 1',source_ids:source,notes:'Lynch family plantation on the South Santee River, St. James Santee Parish. Plantation recorded in 1738; later house dated approximately 1760–1762. Thomas Lynch Sr. transferred the property to Thomas Lynch Jr., reportedly in 1772. Elizabeth Shubrick Lynch resided here with her husband. Approximate house-site point: HABS coordinate values interpreted as UTM zone 17N, NAD83, easting 647999 and northing 3673526 (the report reverses the axis labels and omits the zone). Map reference point only, not a surveyed boundary. Historical tract boundary not asserted. Quincy’s March 20, 1773 visit is identified here with Peachtree following Tanner Port’s review of Lynch property records. This is an adopted research inference; the journal leaves the plantation unnamed and exact supporting property-record citations are pending.'});
 const people=[['peachtree_lynch_sr','Thomas Lynch Sr.','Planter and Continental Congress delegate','Owner before reported transfer in 1772','','1772'],['peachtree_lynch_jr','Thomas Lynch Jr.','Signer of the Declaration of Independence','Owner; reported transfer in 1772','1772','1779'],['peachtree_elizabeth','Elizabeth Shubrick Lynch','Member of the Peachtree household','Resident','1772','1779']];
 people.forEach(([id,name,role,rel,from,to])=>{
 const person=(raw.INDIVIDUALS||[]).find(r=>(r.full_name||'').replace(/\./g,'').toLowerCase()===name.replace(/\./g,'').toLowerCase())||add('INDIVIDUALS','ind_id',{ind_id:id,full_name:name,rank:role,tier:'Exception',affiliation:id==='peachtree_elizabeth'?'Unknown':'Patriot',lat:'',lng:'',source_ids:source,evidence_type:'Secondary'});
 add('IND_PROPERTY','link_id',{link_id:'ip_'+id,ind_id:person.ind_id,prop_id:property.prop_id,relationship:rel,date_from:from,date_to:to,source_ids:source});
 });
 const quincy=(raw.INDIVIDUALS||[]).find(r=>/josiah quincy/i.test(r.full_name||''));
 if(quincy)add('IND_PROPERTY','link_id',{link_id:'ip_quincy_peachtree_17730320',ind_id:quincy.ind_id,prop_id:property.prop_id,relationship:'Visitor — inferred identification from Tanner Port’s property research; citations pending',date_from:'1773-03-20',date_to:'1773-03-21',source_ids:source});
}};
