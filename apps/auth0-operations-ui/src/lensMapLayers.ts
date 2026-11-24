import type { Map, StyleSpecification } from 'maplibre-gl';
import { countries } from './lensGeography';

export const mapStyle: StyleSpecification = {
 version:8, sources:{countries:{type:'geojson', data:countries, promoteId:undefined, attribution:'Country boundaries: Natural Earth'}},
 layers:[
  {id:'ocean', type:'background', paint:{'background-color':'#0b0d0c'}},
  {id:'countries', type:'fill', source:'countries', paint:{'fill-color':['case',['boolean',['feature-state','selected'],false],'#24502d',['boolean',['feature-state','hover'],false],'#1f3324','#171c19'],'fill-opacity':1}},
  {id:'borders', type:'line', source:'countries', paint:{'line-color':'#2a332d','line-width':0.6}},
 ]
};
export function addDataLayers(map: Map) {
 const empty = {type:'FeatureCollection' as const, features:[]};
 map.addSource('activity',{type:'geojson',data:empty});
 map.addLayer({id:'heat',type:'heatmap',source:'activity',maxzoom:12,paint:{'heatmap-weight':['interpolate',['linear'],['get','count'],0,0,10,1], 'heatmap-intensity':['interpolate',['linear'],['zoom'],0,1,9,2], 'heatmap-radius':['interpolate',['linear'],['zoom'],0,14,9,32], 'heatmap-opacity':['interpolate',['linear'],['zoom'],8,0.85,12,0.4], 'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(0,0,0,0)',0.2,'rgba(61,165,78,0.45)',0.5,'#3da54e',1,'#c9f5d0']}});
 map.addSource('anomalies',{type:'geojson',data:empty,cluster:true,clusterRadius:24,clusterMaxZoom:12});
 map.addLayer({id:'anomaly-hit',type:'circle',source:'anomalies',paint:{'circle-radius':16,'circle-color':'#ff625c','circle-opacity':0.02}});
 map.addLayer({id:'anomaly',type:'circle',source:'anomalies',paint:{'circle-radius':['case',['has','point_count'],9,6],'circle-color':'#f06a5f','circle-stroke-color':'#ffe0dd','circle-stroke-width':2}});
}
