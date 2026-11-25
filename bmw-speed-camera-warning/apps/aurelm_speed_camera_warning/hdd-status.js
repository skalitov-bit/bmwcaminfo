'use strict';
const REASONS={
 MAP_HDD_NOT_FOUND:'ПУТЬ HDD НЕ НАЙДЕН',MAP_HDD_NOT_MOUNTED:'ДИСК НЕ ПОДКЛЮЧЁН',MAP_HDD_READ_ONLY:'ДИСК ДОСТУПЕН ТОЛЬКО ДЛЯ ЧТЕНИЯ',
 MAP_HDD_SAME_DEVICE:'ЭТО ВНУТРЕННЕЕ ХРАНИЛИЩЕ ПРИЛОЖЕНИЯ',MAP_HDD_PATH:'НЕБЕЗОПАСНЫЙ ПУТЬ КАРТ',MAP_HDD_OTHER_DISK:'ДРУГОЙ ДИСК: СОХРАНЕНЫ КАРТЫ НА ПРЕЖНЕМ',
 MAP_HDD_PLATFORM:'ПРОВЕРКА HDD ДОСТУПНА НА MGU',EACCES:'НЕТ ПРАВ ЗАПИСИ',EPERM:'НЕТ ПРАВ ЗАПИСИ',EROFS:'ДИСК ДОСТУПЕН ТОЛЬКО ДЛЯ ЧТЕНИЯ',
 MAP_HDD_HELPER_BUSY:'СИСТЕМНЫЙ ПОМОЩНИК ЗАНЯТ',MAP_HDD_HELPER_FAILED:'ОШИБКА СИСТЕМНОГО ПОМОЩНИКА',MAP_HDD_HELPER_RESPONSE:'НЕВЕРНЫЙ ОТВЕТ СИСТЕМНОГО ПОМОЩНИКА',
 MAP_HDD_HELPER_UNAVAILABLE:'СИСТЕМНЫЙ ПОМОЩНИК НЕДОСТУПЕН',MAP_HDD_HELPER_UPDATE:'ТРЕБУЕТСЯ ОБНОВЛЕНИЕ ЗВУКОВОГО КОМПОНЕНТА',
 MAP_HDD_HELPER_TIMEOUT:'НЕТ ОТВЕТА СИСТЕМНОГО ПОМОЩНИКА',MAP_HDD_HELPER_IDENTITY:'НЕ ПОДТВЕРЖДЁН ВЛАДЕЛЕЦ ПАПКИ SPEEDCAM',MAP_HDD_HELPER_OWNER:'ПАПКА HDD ПРИНАДЛЕЖИТ ДРУГОМУ ВЛАДЕЛЬЦУ',
 MAP_HDD_CHANGED:'ДИСК ОТКЛЮЧИЛСЯ ИЛИ ИЗМЕНИЛСЯ',MAP_HDD_UNAVAILABLE:'HDD НЕДОСТУПЕН',MAP_HDD_ENOSPC:'НЕДОСТАТОЧНО МЕСТА НА HDD',ENOSPC:'НЕДОСТАТОЧНО МЕСТА НА HDD',MAP_HDD_FREE_UNKNOWN:'НЕ УДАЛОСЬ ОПРЕДЕЛИТЬ СВОБОДНОЕ МЕСТО',MAP_HASH:'КАРТА НЕ ПРОШЛА ПРОВЕРКУ ЦЕЛОСТНОСТИ',MAP_SIZE:'НЕВЕРНЫЙ РАЗМЕР ФАЙЛА КАРТЫ'
};
function reason(code){return REASONS[code]||String(code||'ГОТОВО').slice(0,110);}
module.exports={reason,REASONS};
