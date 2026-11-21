'use strict';
// Immutable CSR index: numeric cell keys, offsets and block references.
// The on-disk format and block order are unchanged.
const STRIDE=20001,SHIFT=10000;
const numberKey=(y,x)=>(y+SHIFT)*STRIDE+x+SHIFT;
class PackedCells{
 constructor(cells){
  const rows=[];let total=0;
  for(const key of Object.keys(cells)){
   const p=key.split(':'),y=Number(p[0]),x=Number(p[1]);
   // Non-canonical keys were not reachable by the old integer grid lookup.
   if(y+':'+x!==key)continue;
   if(!Number.isInteger(y)||!Number.isInteger(x)||Math.abs(y)>=SHIFT||Math.abs(x)>=SHIFT)throw Error('HYBRID_CELL_RANGE');
   rows.push({key:numberKey(y,x),values:cells[key]});total+=cells[key].length;
  }
  rows.sort((a,b)=>a.key-b.key);
  this.keys=new Uint32Array(rows.length);this.offsets=new Uint32Array(rows.length+1);this.values=new Uint32Array(total);
  let pos=0;
  rows.forEach((r,i)=>{this.keys[i]=r.key;this.offsets[i]=pos;this.values.set(r.values,pos);pos+=r.values.length;});
  this.offsets[rows.length]=pos;
 }
 addTo(set,y,x){
  if(Math.abs(y)>=SHIFT||Math.abs(x)>=SHIFT)return;
  const key=numberKey(y,x),keys=this.keys;let lo=0,hi=keys.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(keys[mid]<key)lo=mid+1;else hi=mid;}
  if(lo===keys.length||keys[lo]!==key)return;
  for(let i=this.offsets[lo];i<this.offsets[lo+1];i++)set.add(this.values[i]);
 }
}
module.exports={PackedCells};
