'use strict';

// Keep technical diagnostics in the log, not in the limited space on the map.
function updateFailure(error){
 const detail=String(error&&error.message||error||'');
 const code=String(error&&error.code||'')+' '+detail;
 const retained='ИСПОЛЬЗУЕТСЯ УСТАНОВЛЕННАЯ БАЗА';
 if(/\b(?:ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EHOSTDOWN|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EPIPE|ERR_NETWORK|CAMERA_DB_TIMEOUT|CAMERA_DB_TOTAL_TIMEOUT|CAMERA_DB_DOWNLOAD_ABORTED|CAMERA_DB_DOWNLOAD_INTERRUPTED)\b/i.test(code)){
  return {title:'НЕТ СВЯЗИ С СЕРВЕРОМ',lines:['ПРОВЕРЬТЕ ПОДКЛЮЧЕНИЕ К ИНТЕРНЕТУ',retained]};
 }
 if(/CAMERA_DB_HTTP_\d+/.test(code))return {title:'СЕРВЕР НЕ ВЫДАЛ ОБНОВЛЕНИЕ',lines:['ПОПРОБУЙТЕ ОБНОВИТЬ ПОЗЖЕ',retained]};
 return {title:'НЕ УДАЛОСЬ ОБНОВИТЬ БАЗУ',lines:['ПОПРОБУЙТЕ ОБНОВИТЬ ПОЗЖЕ',retained]};
}

module.exports={updateFailure};
