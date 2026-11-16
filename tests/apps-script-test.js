/* Проверка скрипта Apps Script на заглушках Google-объектов: node tests/apps-script-test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'apps-script.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'получено ' + JSON.stringify(got) + ', ожидалось ' + JSON.stringify(want));
}

/* ---------- заглушки Google Apps Script ---------- */
function makeSheet(rows) {
  const data = (rows || []).map((r) => r.slice());

  const range = (row, col, numRows, numCols) => ({
    getValues() {
      return data.slice(row - 1, row - 1 + numRows)
        .map((r) => r.slice(col - 1, col - 1 + numCols));
    },
    setValues(values) {
      for (let i = 0; i < values.length; i++) {
        const r = row - 1 + i;
        while (data.length <= r) data.push([]);
        for (let j = 0; j < values[i].length; j++) data[r][col - 1 + j] = values[i][j];
      }
    },
    setNumberFormat() { return this; },
  });

  const sheet = {
    data,
    getLastRow() { return data.length; },
    appendRow(values) { data.push(values.slice()); },
    deleteRow(r) { data.splice(r - 1, 1); },
    getRange(a, b, c, d) {
      if (typeof a === 'string') return range(1, 1, Math.max(data.length, 1), 1);
      return range(a, b, c, d);
    },
  };
  return sheet;
}

function runScript(sheet) {
  const outputs = [];
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
    Utilities: {
      formatDate(date, tz, pattern) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return pattern === 'yyyy-MM-dd' ? y + '-' + m + '-' + d : date.toISOString();
      },
    },
    Session: { getScriptTimeZone: () => 'Europe/Moscow' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput(text) {
        const out = { text: text, mime: null, setMimeType(m) { this.mime = m; return this; } };
        outputs.push(out);
        return out;
      },
    },
    Date: Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return {
    post(body) {
      const res = sandbox.doPost({ postData: { contents: JSON.stringify(body) } });
      return JSON.parse(res.text);
    },
    sheet,
  };
}

const game = (id, extra) => Object.assign({
  sheet: 'История', id: id, date: '17.11.2026', teamCount: 2,
  score: 'Синие–Красные 3:1', teams: ['Юра 7.7/8.0', 'Максим Б. 6.4/8.0', ''],
}, extra || {});

/* ================= 1. Первая запись ================= */
console.log('\n[1] Пустой лист');
{
  const sheet = makeSheet([]);
  const s = runScript(sheet);
  const res = s.post(game('2026-11-17'));
  eq('ответ ok', res.ok, true);
  eq('первая запись — не обновление', res.updated, false);
  eq('строк стало две (шапка + игра)', sheet.data.length, 2);
  eq('шапка на месте', sheet.data[0].slice(0, 3), ['ID', 'Дата', 'Команд']);
  eq('ID записан текстом', sheet.data[1][0], '2026-11-17');
  eq('состав на месте', sheet.data[1][4], 'Юра 7.7/8.0');
}

/* ================= 2. Повторное сохранение той же даты ================= */
console.log('\n[2] Повторное сохранение той же даты');
{
  const sheet = makeSheet([]);
  const s = runScript(sheet);
  s.post(game('2026-11-17'));
  const res = s.post(game('2026-11-17', { score: 'Синие–Красные 5:2' }));
  eq('помечено как обновление', res.updated, true);
  eq('дублей нет — одна игра', sheet.data.length, 2, sheet.data.length);
  eq('счёт обновлён', sheet.data[1][3], 'Синие–Красные 5:2');
}

/* ================= 3. Старый лист, где ID стал датой ================= */
console.log('\n[3] Старые строки с ID-датой и дублями');
{
  const header = ['ID', 'Дата', 'Команд', 'Итог', 'Синие', 'Красные', 'Белые', 'Обновлено'];
  const sheet = makeSheet([
    header,
    [new Date(2026, 10, 17), '17.11.2026', 2, 'старый счёт', 'старый', 'старый', '', new Date()],
    [new Date(2026, 10, 17), '17.11.2026', 2, 'свежий счёт', 'свежий', 'свежий', '', new Date()],
  ]);
  const s = runScript(sheet);
  const res = s.post(game('2026-11-17', { score: 'Синие–Красные 9:9' }));
  eq('нашёл и обновил, а не дописал', res.updated, true, res);
  eq('удалено дублей', res.duplicates, 1, res);
  eq('осталась одна игра', sheet.data.length, 2, sheet.data.length);
  eq('ID стал текстом', typeof sheet.data[1][0], 'string');
  eq('новый счёт на месте', sheet.data[1][3], 'Синие–Красные 9:9');
}

/* ================= 4. Удаление ================= */
console.log('\n[4] Удаление');
{
  const header = ['ID', 'Дата', 'Команд', 'Итог', 'Синие', 'Красные', 'Белые', 'Обновлено'];
  const sheet = makeSheet([
    header,
    ['2026-11-17', '17.11.2026', 2, '', 'a', 'b', '', ''],
    ['2026-11-17', '17.11.2026', 2, '', 'c', 'd', '', ''],
    ['2026-11-24', '24.11.2026', 2, '', 'e', 'f', '', ''],
  ]);
  const s = runScript(sheet);
  const res = s.post({ sheet: 'История', action: 'delete', id: '2026-11-17' });
  eq('удалено две строки', res.deleted, 2, res);
  eq('осталась шапка и другая игра', sheet.data.length, 2, sheet.data.length);
  eq('другая игра не тронута', sheet.data[1][0], '2026-11-24');

  const again = s.post({ sheet: 'История', action: 'delete', id: '2026-11-17' });
  eq('повторное удаление ничего не находит', again.deleted, 0, again);
}

/* ================= 5. Удаление строки, где ID — дата ================= */
console.log('\n[5] Удаление строки с ID-датой');
{
  const header = ['ID', 'Дата', 'Команд', 'Итог', 'Синие', 'Красные', 'Белые', 'Обновлено'];
  const sheet = makeSheet([
    header,
    [new Date(2026, 0, 1), '1.1.2026', 2, '', 'Тест', '', '', ''],
  ]);
  const s = runScript(sheet);
  const res = s.post({ sheet: 'История', action: 'delete', id: '2026-01-01' });
  eq('дата спасена нормализацией', res.deleted, 1, res);
  eq('осталась только шапка', sheet.data.length, 1, sheet.data.length);
}

/* ================= 6. Ошибочные данные ================= */
console.log('\n[6] Ошибочные данные');
{
  const sheet = makeSheet([]);
  const s = runScript(sheet);
  const res = s.post({ sheet: 'История', teams: ['x', '', ''] });
  eq('без id — понятная ошибка', res.ok, false);
  eq('в лист ничего не попало', sheet.data.length, 0, sheet.data.length);

  const res2 = s.post({ sheet: 'История', id: 'probe-text-id', teams: ['x', '', ''] });
  eq('текстовый id принимается', res2.ok, true, res2);
  eq('и записывается как есть', sheet.data[1][0], 'probe-text-id');
  eq('без команд не падает', sheet.data[1][4], 'x');
}

/* ================= 7. Код в приложении совпадает с файлом ================= */
console.log('\n[7] Код в приложении и в файле не расходятся');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<pre class="codeblock" id="scriptCode">([\s\S]*?)<\/pre>/);
  ok('блок кода найден', !!m);
  const inApp = m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+$/, '');
  eq('код в настройках = apps-script.js', inApp, source.replace(/\s+$/, ''));
}

console.log('\nИтог: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
