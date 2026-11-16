/**
 * История игр teambalancer → лист «История».
 *
 * Как подключить:
 * 1. В таблице: Расширения → Apps Script, вставить этот код.
 * 2. Развернуть → Новое развёртывание → тип «Веб-приложение»,
 *    запуск от своего имени, доступ «все». Скопировать адрес (…/exec).
 * 3. В приложении на экране «История» вставить адрес в поле «Адрес веб-приложения».
 *
 * После правки кода ВСЕГДА создавать новую версию развёртывания
 * («Развернуть» → «Управление развёртываниями» → карандаш → версия «Новая»),
 * иначе работает прежняя версия кода.
 *
 * Важно про ID: Google Таблицы охотно превращают «2026-11-17» в дату, и тогда сравнение
 * со строкой не совпадает — сохранение дописывает дубль, удаление ничего не находит.
 * Поэтому колонка ID держится в текстовом формате, а значения сравниваются через idOf().
 */

var SHEET = 'История';
var HEADER = ['ID', 'Дата', 'Команд', 'Итог', 'Синие', 'Красные', 'Белые', 'Обновлено'];

/** Значение ячейки ID → текст «2026-11-17» (дата тоже приводится к этому виду). */
function idOf(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value == null ? '' : value).trim();
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    var id = idOf(body.id);
    if (!id) return json({ ok: false, error: 'Не передан id игры' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
    if (sh.getLastRow() === 0) sh.appendRow(HEADER);

    // ID — текстом, и старые строки тоже приводим к тексту, иначе поиск по ID не совпадёт
    sh.getRange('A:A').setNumberFormat('@');
    if (sh.getLastRow() > 1) {
      var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) ids[i] = [idOf(ids[i][0])];
      sh.getRange(2, 1, ids.length, 1).setValues(ids);
    }

    /** Номера строк листа с этим ID (снизу вверх — свежие последними). */
    var findRows = function () {
      var last = sh.getLastRow();
      if (last < 2) return [];
      var values = sh.getRange(2, 1, last - 1, 1).getValues();
      var found = [];
      for (var k = 0; k < values.length; k++) {
        if (idOf(values[k][0]) === id) found.push(k + 2);
      }
      return found;
    };

    if (body.action === 'delete') {
      var rows = findRows();
      for (var d = rows.length - 1; d >= 0; d--) sh.deleteRow(rows[d]);
      return json({ ok: true, deleted: rows.length });
    }

    var teams = body.teams || [];
    var row = [id, body.date || '', body.teamCount || 0, body.score || '',
      teams[0] || '', teams[1] || '', teams[2] || '', new Date()];

    var dup = findRows();
    if (dup.length) {
      // повторное сохранение той же даты: обновляем последнюю строку, лишние дубли убираем
      var keep = dup[dup.length - 1];
      for (var j = dup.length - 2; j >= 0; j--) sh.deleteRow(dup[j]);
      sh.getRange(keep - (dup.length - 1), 1, 1, row.length).setValues([row]);
      return json({ ok: true, updated: true, duplicates: dup.length - 1 });
    }

    sh.appendRow(row);
    return json({ ok: true, updated: false });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
