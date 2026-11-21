'use strict';
// The satellite is an embedded monochrome glyph, identical on PNG and GPU.
const captions={searching:'ПОИСК СИГНАЛА',lost:'НЕТ СИГНАЛА',unreliable:'НЕДОСТОВЕРЕН',degraded:'ТОЧНОСТЬ СНИЖЕНА',reserve:'НЕТ СИГНАЛА / РАСЧЁТ',waiting:'ОЖИДАНИЕ КООРДИНАТ',unstable:'НЕСТАБИЛЕН',capture:'НУЖНА ТОЧНОСТЬ ДО 15 М'};
function gpsMessage(status){return '🛰 GPS: '+(captions[status]||status);}
module.exports={gpsMessage};
