/* Логика teambalancer без браузера: node tests/logic-test.js */
'use strict';

const path = require('path');
const T = require(path.join(__dirname, '..', 'app.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' → ' + extra : '')); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, 'получено ' + g + ', ожидалось ' + w);
}

/* ---------- фиксируем «сегодня» ---------- */
const RealDate = Date;
function fakeToday(iso) {
  const fixed = new RealDate(iso + 'T10:00:00');
  global.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(fixed.getTime()); else super(...a); }
    static now() { return fixed.getTime(); }
  };
}
fakeToday('2026-11-12');

/* ================= 1. Выбор даты в матрице явки ================= */
console.log('\n[1] Явка: ручной выбор даты');
const attRows = [
  ['Имя', '17.11.2026', '24.11.2026', '1.12.2026'],
  ['Юра', 'Играю', 'Играю', ''],
  ['Гриша', 'Не играю', 'Играю', ''],
  ['Дима', 'Играю', '', 'Не играю'],
];

const auto = T.parseAttendance(attRows);
eq('12.11 авто-дата = 17.11', auto.dateKey, '2026-11-17');
eq('12.11 придут', auto.going, ['Юра', 'Дима']);
eq('подпись даты как в шапке', auto.dateLabel, '17.11.2026');
eq('колонок три', auto.columns.length, 3);
eq('autoKey', auto.autoKey, '2026-11-17');

const pick = T.parseAttendance(attRows, '2026-11-24');
eq('ручной выбор 24.11', pick.dateKey, '2026-11-24');
eq('24.11 придут', pick.going, ['Юра', 'Гриша']);
eq('autoKey остаётся ближайшим', pick.autoKey, '2026-11-17');

const pickEmpty = T.parseAttendance(attRows, '2026-12-01');
eq('1.12 без отметок → пусто', pickEmpty.going, []);
eq('1.12 не «не играю»', pickEmpty.notGoing, ['Дима']);

const pickMissing = T.parseAttendance(attRows, '2026-12-25');
eq('несуществующая дата → откат на авто', pickMissing.dateKey, '2026-11-17');

fakeToday('2026-11-18');
const after = T.parseAttendance(attRows);
eq('18.11 авто-дата = 24.11', after.dateKey, '2026-11-24');

fakeToday('2026-12-10');
const past = T.parseAttendance(attRows);
eq('10.12 (все прошли) → последняя с отметками 1.12', past.dateKey, '2026-12-01');
fakeToday('2026-11-12');

/* ================= 2. Лист ответов формы: тоже колонки ================= */
console.log('\n[2] Явка: формат ответов формы');
const formRows = [
  ['Отметка времени', 'Дата игры', 'Игрок', 'Приду'],
  ['2026-11-10 10:00', '17.11.2026', 'Юра', 'Да'],
  ['2026-11-10 11:00', '17.11.2026', 'Гриша', 'Нет'],
  ['2026-11-10 12:00', '24.11.2026', 'Юра', 'Да'],
  ['2026-11-10 13:00', '24.11.2026', 'Дима', 'Да'],
];
const formAuto = T.parseAttendance(formRows);
eq('форма: авто = 17.11', formAuto.dateKey, '2026-11-17');
eq('форма: придут 17.11', formAuto.going, ['Юра']);
const formPick = T.parseAttendance(formRows, '2026-11-24');
eq('форма: ручной 24.11', formPick.going, ['Юра', 'Дима']);
eq('форма: колонки по датам', formPick.columns.length, 2);

/* ================= 3. Ячейки команд и счёта ================= */
console.log('\n[3] Формат ячеек');
const team = {
  name: 'Синие',
  players: [{ name: 'Юра', field: 7.1, gk: 5 }, { name: 'Дима Д.', field: 6.9, gk: 4.04 }],
};
const teamCell = T.formatTeamCell(team);
eq('команда → ячейка', teamCell, 'Юра 7.1/5.0; Дима Д. 6.9/4.0');
const back = T.parseTeamCell(teamCell, 'Синие');
eq('ячейка → команда: имена', back.players.map((p) => p.name), ['Юра', 'Дима Д.']);
eq('ячейка → команда: оценки', back.players.map((p) => [p.field, p.gk]), [[7.1, 5], [6.9, 4]]);
eq('имя с пробелом не съедается', T.parseTeamCell('Саша МВД 8.5/6.5', 'Синие').players[0].name, 'Саша МВД');
eq('битая ячейка → имя без оценок', T.parseTeamCell('Петя', 'Синие').players[0].field, null);

const matches = [
  { a: 'Синие', b: 'Красные', ga: 3, gb: 1 },
  { a: 'Синие', b: 'Белые', ga: 2, gb: 2 },
  { a: 'Красные', b: 'Белые', ga: 1, gb: 0 },
];
const scoreCell = T.formatScoreCell(matches);
eq('матчи → ячейка', scoreCell, 'Синие–Красные 3:1; Синие–Белые 2:2; Красные–Белые 1:0');
eq('ячейка → матчи', T.parseScoreCell(scoreCell), matches);
eq('пустая ячейка → нет матчей', T.parseScoreCell(''), []);

/* ================= 4. Чтение листа истории ================= */
console.log('\n[4] Лист «История»');
const histRows = [
  ['ID', 'Дата', 'Команд', 'Итог', 'Синие', 'Красные', 'Белые', 'Обновлено'],
  ['2026-11-17', '17.11.2026', '3', scoreCell,
    'Юра 8.0/6.0; Гриша 7.0/4.0', 'Дима 7.5/5.0; Олег 6.5/5.0', 'Антон 6.0/4.0; Веня 5.5/4.5', '12.11.2026'],
  ['2026-11-24', '24.11.2026', '2', 'Синие–Красные 0:2',
    'Юра 8.0/6.0', 'Гриша 7.0/4.0', '', '20.11.2026'],
];
const games = T.parseHistoryRows(histRows);
eq('игр прочитано', games.length, 2);
eq('сортировка от новых к старым', games.map((g) => g.id), ['2026-11-24', '2026-11-17']);
eq('команд в игре 1', games[1].teams.length, 3);
eq('команд в игре 2 (пустая колонка пропущена)', games[0].teams.length, 2);
eq('счёт прочитан', games[1].matches.length, 3);
eq('имена в команде', games[1].teams[0].players.map((p) => p.name), ['Юра', 'Гриша']);
eq('пустой лист → пусто', T.parseHistoryRows([histRows[0]]), []);

/* дубли одного ID → одна игра, берётся нижняя (свежая) строка */
const dupRows = [
  ['ID', 'Дата', 'Команд', 'Итог', 'Синие', 'Красные', 'Белые', 'Обновлено'],
  ['2026-11-17', '17.11.2026', '2', '', 'Юра 8.0/6.0', 'Гриша 7.0/4.0', '', '1'],
  ['2026-11-17', '17.11.2026', '2', 'Синие–Красные 4:0', 'Юра 8.0/6.0', 'Гриша 7.0/4.0', '', '2'],
];
const dup = T.parseHistoryRows(dupRows);
eq('дубли ID схлопнуты в одну игру', dup.length, 1);
eq('взята свежая (нижняя) строка со счётом', dup[0].matches.length, 1);

/* ================= 5. Статистика ================= */
console.log('\n[5] Статистика');
const st = T.historyStats(games);
const byName = new Map(st.players.map((p) => [p.name, p]));

eq('игр всего', st.games, 2);
eq('игр со счётом', st.scored, 2);
eq('баланс угадал результат в 1 из 2', [st.topWon, st.scored], [1, 2]);

eq('Юра: игр', byName.get('Юра').games, 2);
eq('Юра: В/Н/П', [byName.get('Юра').w, byName.get('Юра').d, byName.get('Юра').l], [1, 1, 1]);
eq('Юра: очки', byName.get('Юра').pts, 4);

eq('Гриша: игр', byName.get('Гриша').games, 2);
eq('Гриша: В/Н/П', [byName.get('Гриша').w, byName.get('Гриша').d, byName.get('Гриша').l], [2, 1, 0]);
eq('Гриша: очки', byName.get('Гриша').pts, 7);

eq('Веня один раз', byName.get('Веня').games, 1);

const pairKey = (x, y) => [x, y].sort().join('+');
const pairMap = new Map(st.pairs.map((p) => [pairKey(p.a, p.b), p.times]));
eq('Юра и Гриша вместе 1 раз', pairMap.get(pairKey('Юра', 'Гриша')), 1);

const noScore = T.historyStats([{ id: 'x', dateLabel: 'x', teams: games[1].teams, matches: [] }]);
eq('без счёта: очков нет', noScore.players.every((p) => p.pts === 0), true);
eq('без счёта: посещаемость есть', noScore.players.find((p) => p.name === 'Юра').games, 1);
eq('без счёта: scored 0', noScore.scored, 0);

const draw = T.historyStats([{
  id: 'd', dateLabel: 'd', matches: [{ a: 'Синие', b: 'Красные', ga: 1, gb: 1 }],
  teams: [
    { name: 'Синие', players: [{ name: 'A', field: 7, gk: 5 }] },
    { name: 'Красные', players: [{ name: 'B', field: 6, gk: 5 }] },
  ],
}]);
eq('ничья: очки 1-1', draw.players.map((p) => p.pts), [1, 1]);
eq('ничья: баланс угадал (равные голы)', [draw.topWon, draw.scored], [1, 1]);

const upset = T.historyStats([{
  id: 'u', dateLabel: 'u', matches: [{ a: 'Синие', b: 'Красные', ga: 0, gb: 3 }],
  teams: [
    { name: 'Синие', players: [{ name: 'A', field: 9, gk: 5 }] },
    { name: 'Красные', players: [{ name: 'B', field: 5, gk: 5 }] },
  ],
}]);
eq('сенсация: баланс не угадал', [upset.topWon, upset.scored], [0, 1]);

/* ================= 6. Круговой счёт для 3 команд ================= */
console.log('\n[6] Круговой счёт для 3 команд');
const round = [
  { a: 'Синие', b: 'Красные', ga: 2, gb: 0 },
  { a: 'Синие', b: 'Белые', ga: 1, gb: 1 },
  { a: 'Красные', b: 'Белые', ga: 3, gb: 2 },
];
const r = T.historyStats([{
  id: 'r', dateLabel: 'r', matches: round,
  teams: [
    { name: 'Синие', players: [{ name: 'A', field: 7, gk: 5 }] },
    { name: 'Красные', players: [{ name: 'B', field: 7, gk: 5 }] },
    { name: 'Белые', players: [{ name: 'C', field: 7, gk: 5 }] },
  ],
}]);
const pts = new Map(r.players.map((p) => [p.name, p.pts]));
eq('Синие: 3+1=4', pts.get('A'), 4);
eq('Красные: 0+3=3', pts.get('B'), 3);
eq('Белые: 1+0=1', pts.get('C'), 1);
eq('при равных скилах баланс засчитан', [r.topWon, r.scored], [1, 1]);

console.log('\nИтог: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
