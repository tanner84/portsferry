import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),M=require('../js/movement.js');
const {validateLocation}=require('../netlify/functions/_shared/location-schema.cjs');
const data=JSON.parse(readFileSync(new URL('../data/journeys/quincy-1773.json',import.meta.url)));
test('Quincy arrival, same-day meeting, unknown plantation and reverse lookup',()=>{
 assert.equal(M.at(data.locations,new Date(1773,1,27)),null);
 assert.equal(M.at(data.locations,new Date(1773,1,28),0).place_id,'place_charleston_harbor');
 assert.equal(M.at(data.locations,new Date(1773,1,28),1).place_id,'place_charles_town_coffeehouse');
 assert.equal(M.at(data.locations,new Date(1773,2,1)).last_known,true);
 assert.equal(M.at(data.locations,new Date(1773,2,20)).place_id,'place_lynch_santee_unidentified');
 assert.equal(M.at(data.locations,new Date(1773,2,21)).place_id,'place_georgetown_sc');
 assert.equal(M.at(data.locations,new Date(1773,1,28),0).place_id,'place_charleston_harbor');
});
test('unknown coordinates are never zero; proposed evidence is excluded',()=>{
 assert.equal(M.coordinate(''),null);
 assert.equal(M.at([{...data.locations[0],evidence_status:'proposed'}],new Date(1773,2,1)),null);
});
test('invalid dates and backwards ranges rejected; all example records validate',()=>{
 assert.equal(M.parseDate('1773-02-30'),null);
 assert.ok(validateLocation({...data.locations[0],date_to:'1772-01-01'}).length);
 data.locations.forEach(r=>assert.deepEqual(validateLocation(r),[]));
});
