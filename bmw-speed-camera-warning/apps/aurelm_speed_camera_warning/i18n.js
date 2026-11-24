'use strict';
// Translate at the presentation boundary: stored data, source codes and routing stay unchanged.
const source=require('./i18n-en.json'),dictionary=Object.create(null);
Object.keys(source).forEach(k=>{dictionary[k.toUpperCase()]=source[k];});
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const phrases=Object.create(null);
Object.keys(dictionary).forEach(k=>{if(k.trim())phrases[k.trim()]=dictionary[k].trim();});
const keys=Object.keys(phrases).sort((a,b)=>b.length-a.length);
// Apply word boundaries in the expression, not after matching: a rejected short
// unit such as " м" must not consume the beginning of "МАСШТАБ".
const pattern=new RegExp('(^|[^A-ZА-ЯЁ])('+keys.map(escape).join('|')+')(?=$|[^A-ZА-ЯЁ])','gi');
let current='ru';const cache=new Map();
function setLanguage(value){const next=value==='en'?'en':'ru';if(current!==next){current=next;cache.clear();}return current;}
const translit={А:'A',Б:'B',В:'V',Г:'G',Д:'D',Е:'E',Ё:'E',Ж:'ZH',З:'Z',И:'I',Й:'Y',К:'K',Л:'L',М:'M',Н:'N',О:'O',П:'P',Р:'R',С:'S',Т:'T',У:'U',Ф:'F',Х:'KH',Ц:'TS',Ч:'CH',Ш:'SH',Щ:'SHCH',Ъ:'',Ы:'Y',Ь:'',Э:'E',Ю:'YU',Я:'YA'};
function t(value){
 const s=String(value);if(current!=='en'||!/[А-Яа-яЁё]/.test(s))return s;
 if(cache.has(s))return cache.get(s);
 let out=dictionary[s.toUpperCase()];
 if(out===undefined)out=s.replace(pattern,(match,prefix,key)=>prefix+phrases[key.toUpperCase()]);
 // Proper names supplied by downloaded maps/camera models have no translation catalog.
 // Transliterate those labels; never alter coordinates, identifiers or the original records.
 out=out.replace(/[А-ЯЁ]/gi,ch=>{const v=translit[ch.toUpperCase()];return ch===ch.toUpperCase()?v:v.toLowerCase();});
 if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(s,out);return out;
}
function voiceFile(file){return current==='en'&&file&&!/^en-|^beeper-/.test(file)?'en-'+file:file;}
module.exports={t,setLanguage,language:()=>current,voiceFile};
