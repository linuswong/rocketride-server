import test from 'node:test';
import assert from 'node:assert/strict';
import { geographicData, countries } from '../src/lensGeography.ts';
import { normalize } from '../src/loginLensAnalytics.ts';
import { exampleEvents } from '../src/lensExample.ts';
const e=(id,kind,lon,lat,account)=>({id,kind,time:1,category:'test',app:'test',account,origin:{lon,lat,label:id}});
test('counts deduplicated events and identifiable accounts using country polygons',()=>{
 const us=e('1','success',-122.4,37.8,1), us2=e('2','failure',-122.4,37.8,1), us3=e('3','protection',-75,40), gb=e('4','failure',-0.1,51.5,2);
 const anomaly={id:'a',events:[{...us2},{...gb}],rule:'test',severity:'High',start:0,end:2,explanation:'test',limitation:'test'};
 const d=geographicData([us,us,us2,us3,gb], [anomaly], 'all');
 assert.deepEqual(d.stats.get('840'),{name:'United States of America',accounts:1,success:1,failure:1,protection:1,anomalies:1});
 assert.equal(d.stats.get('826').anomalies,1); assert.equal(d.anomalies.features.length,2);
 assert.equal(d.points.features.find(f=>f.geometry.coordinates[0]===-122.4).properties.count,2);
 assert.equal(geographicData([us,us2,gb],[anomaly],'failure').points.features.length,2);
});
test('ignores missing and invalid origins and accepts demo and normalized live data',()=>{
 const invalid=e('x','failure',NaN,0), missing={...e('y','success',0,0),origin:undefined};
 assert.equal(geographicData([invalid,missing],[],'all').missing,2);
 assert.ok(geographicData(exampleEvents(Date.now()),[],'all').points.features.length);
 const live=normalize([{log_id:'live',date:'2026-11-18T12:00:00Z',type:'s',latitude:51.5,longitude:-0.1}]).events;
 assert.equal(geographicData(live,[],'all').stats.get('826').success,1);
});


test('splits date-line countries without world-spanning edges and preserves membership',()=>{
 for (const name of ['Russia','Fiji']) {
  const country=countries.features.find(c=>c.properties.name===name);
  const polygons=country.geometry.type==='Polygon'?[country.geometry.coordinates]:country.geometry.coordinates;
  for(const polygon of polygons) for(const ring of polygon) for(let i=1;i<ring.length;i++) assert.ok(Math.abs(ring[i][0]-ring[i-1][0])<=180, `${name} contains a world-spanning edge`);
 }
 const events=[e('east','success',179.3,66,1),e('west','failure',-179.5,68,2),e('fiji','success',179.9,-16.5,3)];
 const data=geographicData(events,[],'all');
 assert.equal(data.stats.get('643')?.success,1);
 assert.equal(data.stats.get('643')?.failure,1);
 assert.equal(data.stats.get('242')?.success,1);
});
