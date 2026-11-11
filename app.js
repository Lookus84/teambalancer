/* Баланс команд — логика и UI. Без зависимостей.
   Модель: у каждого игрока 6 полевых скилов и 5 вратарских —
   вратарём может быть любой, позиции меняются. */
'use strict';

/* ======================================================================
   Константы
   ====================================================================== */

const FIELD_KEYS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
const GK_KEYS = ['ref', 'gkpos'];

/* Насколько вратарская игра весит при балансировке (0 — не учитывать). */
const GK_WEIGHT = 0.6;

/* Вес корзин (ярусов). Меньше 1000 — суммы важнее, корзины решают при равенстве. */
const POT_WEIGHT = 60;

const TEAM_META = [
  { name: 'Синие', color: '#38bdf8' },
  { name: 'Красные', color: '#fb7185' },
  { name: 'Белые', color: '#cbd5e1' },
];

const LS_KEY = 'teambalancer.v2';

/* ======================================================================
   Мелкие утилиты
   ====================================================================== */

const isNum = (v) => typeof v === 'number' && isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function popcount(x) {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/* ======================================================================
   Значения и CSV
   ====================================================================== */

/** Шкала 1–10. Числа > 10 считаем шкалой FIFA (0–99) и делим на 10. */
function num(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().replace(',', '.').replace(/\s/g, '');
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let x = parseFloat(m[0]);
  if (!isFinite(x) || x <= 0) return null;
  if (x > 10) x = x / 10;
  if (x > 10) x = 10;
  if (x < 1) x = 1;
  return round1(x);
}

function parseCSV(text) {
  const parsed = [];
  let row = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',' || c === ';' || c === '\t') {
      row.push(cur); cur = '';
    } else if (c === '\n') {
      row.push(cur); parsed.push(row); row = []; cur = '';
    } else if (c === '\r') {
      /* пропускаем */
    } else {
      cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); parsed.push(row); }

  return parsed.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ======================================================================
   Шапка таблицы
   ====================================================================== */

const HEADER_ALIASES = {
  name: ['имя', 'фио', 'игрок', 'игроки', 'name', 'player', 'ник', 'nick', 'футболист'],
  pac: ['скорость', 'pac', 'speed', 'быстрота', 'бег'],
  sho: ['удар', 'sho', 'shot', 'shooting', 'завершение'],
  pas: ['пас', 'передачи', 'pas', 'passing', 'видение'],
  dri: ['дриблинг', 'дрибл', 'dri', 'dribbling', 'техника'],
  def: ['защита', 'отбор', 'def', 'defence', 'defense', 'defending'],
  phy: ['физика', 'физ', 'сила', 'phy', 'physical'],
  ref: ['реакция', 'реакции', 'ref', 'reflexes'],
  gkpos: ['позиционирование', 'позиционированиегк', 'gkpos', 'positioning', 'pos', 'вратарскаяпозиция'],
};

const ALIAS_INDEX = {};
for (const key of Object.keys(HEADER_ALIASES)) {
  for (const a of HEADER_ALIASES[key]) {
    const k = a.replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
    if (k && ALIAS_INDEX[k] == null) ALIAS_INDEX[k] = key;
  }
}

const normHeader = (h) => String(h == null ? '' : h).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');

function mapHeaders(row) {
  const cols = {};
  (row || []).forEach((cellValue, i) => {
    const key = ALIAS_INDEX[normHeader(cellValue)];
    if (key && cols[key] == null) cols[key] = i;
  });
  return cols;
}

function cell(row, idx) {
  if (idx == null || !row) return '';
  return row[idx] == null ? '' : row[idx];
}

/* Порядок колонок, если шапку распознать не удалось: имя + 11 скилов. */
const POSITIONAL = {
  name: 0, pac: 1, sho: 2, pas: 3, dri: 4, def: 5, phy: 6,
  ref: 7, gkpos: 8,
};

function makePlayer(partial) {
  const p = partial || {};
  const skills = {};
  for (const k of FIELD_KEYS) skills[k] = isNum(p.skills && p.skills[k]) ? p.skills[k] : null;
  const gk = {};
  for (const k of GK_KEYS) gk[k] = isNum(p.gk && p.gk[k]) ? p.gk[k] : null;
  return {
    id: p.id || uid(),
    name: String(p.name || '').trim(),
    skills,
    gk,
  };
}

/** Строки таблицы → массив игроков. */
function rowsToPlayers(tableRows) {
  const players = [];
  if (!tableRows || !tableRows.length) return players;

  let headerIdx = -1;
  let cols = null;
  for (let i = 0; i < Math.min(tableRows.length, 6); i++) {
    const m = mapHeaders(tableRows[i]);
    if (m.name != null) { headerIdx = i; cols = m; break; }
  }
  if (!cols) cols = POSITIONAL;

  for (let r = headerIdx + 1; r < tableRows.length; r++) {
    const row = tableRows[r];
    if (!row) continue;
    const name = String(cell(row, cols.name)).trim();
    if (!name) continue;
    if (/^(итого|всего|total|summary)$/i.test(name)) continue;

    const skills = {};
    for (const k of FIELD_KEYS) skills[k] = num(cell(row, cols[k]));
    const gk = {};
    for (const k of GK_KEYS) gk[k] = num(cell(row, cols[k]));

    players.push(makePlayer({ name, skills, gk }));
  }

  return players;
}

/* ======================================================================
   Оценки игрока: в поле и в воротах
   ====================================================================== */

/** Средние по компании — для подстановки незаполненных скилов. */
function contextOf(players) {
  const avgField = {};
  const avgGk = {};
  for (const k of FIELD_KEYS) {
    const vals = players.map((p) => p.skills[k]).filter(isNum);
    avgField[k] = vals.length ? mean(vals) : 6;
  }
  for (const k of GK_KEYS) {
    const vals = players.map((p) => p.gk[k]).filter(isNum);
    avgGk[k] = vals.length ? mean(vals) : 6;
  }
  return { avgField, avgGk };
}

/** Пустые скилы заменяем средними по компании: недозаполнение не наказывает игрока. */
function mixedRating(values, defaults) {
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += isNum(values[i]) ? values[i] : defaults[i];
  }
  return round1(acc / values.length);
}

const fieldRating = (p, ctx) => mixedRating(FIELD_KEYS.map((k) => p.skills[k]), FIELD_KEYS.map((k) => ctx.avgField[k]));
const gkRating = (p, ctx) => mixedRating(GK_KEYS.map((k) => p.gk[k]), GK_KEYS.map((k) => ctx.avgGk[k]));

const fieldFilled = (p) => FIELD_KEYS.filter((k) => isNum(p.skills[k])).length;
const gkFilled = (p) => GK_KEYS.filter((k) => isNum(p.gk[k])).length;

function prepare(players) {
  const ctx = contextOf(players);
  return players.map((p) => Object.assign({}, p, {
    field: fieldRating(p, ctx),
    gk: gkRating(p, ctx),
    fieldFilled: fieldFilled(p),
    gkFilled: gkFilled(p),
    rated: fieldFilled(p) > 0 || gkFilled(p) > 0,
  }));
}

/* ======================================================================
   Балансировка
   ====================================================================== */

function scoreOf(teams, ctx) {
  const fieldSums = teams.map((t) => sum(t.map((p) => p.field)));
  const sizes = teams.map((t) => t.length);

  let s = 1000 * (Math.max.apply(null, fieldSums) - Math.min.apply(null, fieldSums));
  s += 1000 * (Math.max.apply(null, sizes) - Math.min.apply(null, sizes));

  if (ctx.useGk) {
    const gkSums = teams.map((t) => sum(t.map((p) => p.gk)));
    s += 1000 * GK_WEIGHT * (Math.max.apply(null, gkSums) - Math.min.apply(null, gkSums));
  }

  // Корзины: ярусы нарезаны с шагом «число команд», поэтому в идеале
  // в каждой команде ровно по одному игроку из яруса.
  if (ctx.pots && ctx.bandCount) {
    for (let b = 0; b < ctx.bandCount; b++) {
      const counts = teams.map((t) => t.filter((p) => p.band === b).length);
      const sizeInBand = sum(counts);

      // верхняя корзина — жёстко не больше одного «топа» в команде
      if (b === 0) {
        s += 5000 * sum(counts.map((c) => Math.max(0, c - 1)));
        continue;
      }

      const maxC = Math.max.apply(null, counts);
      const minC = Math.min.apply(null, counts);
      const unavoidable = sizeInBand % teams.length === 0 ? 0 : 1;
      s += ctx.potWeight * Math.max(0, (maxC - minC) - unavoidable);
    }
  }
  return s;
}

function greedyAssign(players, k, sizes, ctx, jitter) {
  // Сначала раскладываем по ярусам (корзинам), внутри яруса — по силе.
  // Так каждая команда с самого начала получает по одному игроку из корзины.
  const noisy = players.map((p) => ({ p, r: jitter ? Math.random() : 0 }));
  noisy.sort((a, b) => (a.p.band - b.p.band) || (b.p.field - a.p.field) || (a.r - b.r));

  const teams = Array.from({ length: k }, () => []);
  const sums = new Array(k).fill(0);
  let band = -1;
  let offset = 0;

  for (const item of noisy) {
    const p = item.p;
    if (p.band !== band) { band = p.band; offset = band % k; }

    let best = -1;
    let bestVal = Infinity;
    for (let step = 0; step < k; step++) {
      const i = (offset + step) % k;
      if (teams[i].length >= sizes[i]) continue;
      const inBand = teams[i].filter((x) => x.band === band).length;
      const val = inBand * 100 + sums[i];
      if (val < bestVal) { bestVal = val; best = i; }
    }
    if (best < 0) continue;
    teams[best].push(p);
    sums[best] += p.field;
  }
  return teams;
}

/** Локальный подъём: обмен игроками между командами, пока оценка улучшается. */
function optimize(teams, ctx) {
  let cur = scoreOf(teams, ctx);
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        for (let i = 0; i < teams[a].length; i++) {
          for (let j = 0; j < teams[b].length; j++) {
            const pa = teams[a][i];
            const pb = teams[b][j];
            if (pa.field === pb.field && pa.gk === pb.gk) continue;
            teams[a][i] = pb;
            teams[b][j] = pa;
            const sc = scoreOf(teams, ctx);
            if (sc < cur - 1e-9) {
              cur = sc;
              improved = true;
            } else {
              teams[a][i] = pa;
              teams[b][j] = pb;
            }
          }
        }
      }
    }
    if (!improved) break;
  }
  return cur;
}

function balance(players, k, opts) {
  const list = players.filter((p) => p.rated);
  const n = list.length;
  if (n < k) return { error: 'Игроков с оценками меньше, чем команд.' };

  const ctx = {
    useGk: opts.useGk !== false,
    pots: opts.pots !== false,
    potWeight: opts.potWeight != null ? opts.potWeight : POT_WEIGHT,
  };

  // ярусы (корзины): шаг = число команд, чтобы в каждой команде был один игрок из яруса
  const byRank = list.slice().sort((a, b) => b.field - a.field);
  byRank.forEach((p, i) => { p.band = Math.floor(i / k); });
  ctx.bandCount = n ? Math.floor((n - 1) / k) + 1 : 0;

  const base = Math.floor(n / k);
  const rem = n % k;
  const sizes = Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));

  let best = null;
  let bestScore = Infinity;
  let usedExact = false;

  // Две команды и небольшой состав — точный перебор.
  // Первого игрока фиксируем в «команде A», но её размер пробуем оба:
  // иначе теряются варианты, где он попадает в меньшую команду.
  if (k === 2 && n <= 19 && opts.exact !== false) {
    const rest = list.slice(1);
    const m = rest.length;
    const sizeOpts = sizes[0] === sizes[1] ? [sizes[0]] : [sizes[0], sizes[1]];

    for (const sizeA of sizeOpts) {
      const needA = sizeA - 1;
      if (needA < 0 || needA > m) continue;
      const lim = 1 << m;
      for (let mask = 0; mask < lim; mask++) {
        if (popcount(mask) !== needA) continue;
        const A = [list[0]];
        const B = [];
        for (let i = 0; i < m; i++) ((mask >> i) & 1 ? A : B).push(rest[i]);
        const sc = scoreOf([A, B], ctx);
        if (sc < bestScore - 1e-9) { bestScore = sc; best = [A, B]; }
      }
    }
    usedExact = !!best;
  }

  if (!best) {
    const rounds = 240;
    for (let r = 0; r < rounds; r++) {
      const teams = greedyAssign(list, k, sizes, ctx, r > 0);
      const sc = optimize(teams, ctx);
      if (sc < bestScore - 1e-9) { bestScore = sc; best = teams; }
    }
  }

  const teams = best;
  const sumsFor = (key) => teams.map((t) => sum(t.map((p) => p[key])));
  const fieldSums = sumsFor('field');
  const gkSums = sumsFor('gk');

  return {
    teams,
    fieldSums,
    gkSums,
    sizes,
    fieldDiff: Math.max.apply(null, fieldSums) - Math.min.apply(null, fieldSums),
    gkDiff: Math.max.apply(null, gkSums) - Math.min.apply(null, gkSums),
    excluded: players.filter((p) => !p.rated),
    useGk: ctx.useGk,
    pots: ctx.pots,
    exact: usedExact,
  };
}

/* ======================================================================
   Явка из Google Формы (лист ответов)
   ====================================================================== */

const ATT_ALIASES = {
  ts: ['отметкавремени', 'timestamp', 'время', 'датаответа', 'когда'],
  date: ['датаигры', 'игра', 'дата', 'gamedate', 'game', 'date', 'надень'],
  player: ['игрок', 'имя', 'name', 'player', 'фио', 'участник'],
  answer: ['приду', 'явка', 'иду', 'буду', 'answer', 'attendance', 'ответ'],
};

const ATT_INDEX = {};
for (const key of Object.keys(ATT_ALIASES)) {
  for (const a of ATT_ALIASES[key]) {
    const k = a.replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
    if (k && ATT_INDEX[k] == null) ATT_INDEX[k] = key;
  }
}

const MONTH_STEMS = [
  ['январ', 1], ['феврал', 2], ['март', 3], ['апрел', 4], ['ма', 5],
  ['июн', 6], ['июл', 7], ['август', 8], ['сентябр', 9], ['октябр', 10],
  ['ноябр', 11], ['декабр', 12],
];

/** «14.11.2026», «2026-11-14», «14 ноября» → { key, label } */
function parseGameDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  let y = null;
  let m = null;
  let d = null;

  let mt = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }

  if (!m) {
    mt = raw.match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
    if (mt) { d = +mt[1]; m = +mt[2]; if (mt[3]) { y = +mt[3]; if (y < 100) y += 2000; } }
  }

  if (!m) {
    const low = raw.toLowerCase();
    const dayMatch = low.match(/(\d{1,2})/);
    const month = MONTH_STEMS.find((s) => low.indexOf(s[0]) >= 0);
    if (dayMatch && month) { d = +dayMatch[1]; m = month[1]; }
  }

  if (!m || !d || m > 12 || d > 31) return null;
  if (!y) y = new Date().getFullYear();
  const key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const label = String(d).padStart(2, '0') + '.' + String(m).padStart(2, '0') + '.' + y;
  return { key, label };
}

/** «Иван П.» и «иван п» → «иванп» */
function normalizeName(v) {
  return String(v == null ? '' : v)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-zа-я0-9]/g, '');
}

function isGoingAnswer(text) {
  const s = String(text == null ? '' : text).toLowerCase().replace(/ё/g, 'е');
  if (!s.trim()) return null;
  if (/(^|\s)не\s|нет|небуду|неприду|пас/.test(s)) return false;
  if (/приду|буду|иду|да|\+|yes|true|конечно/.test(s)) return true;
  return null;
}

/** Строки листа ответов → { dateKey, dateLabel, going, notGoing, unknown } */
function parseAttendance(rows) {
  if (!rows || !rows.length) return { error: 'Лист ответов пуст.' };

  let headerIdx = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const found = {};
    (rows[i] || []).forEach((cv, idx) => {
      const key = ATT_INDEX[normHeader(cv)];
      if (key && found[key] == null) found[key] = idx;
    });
    if (found.player != null && found.answer != null) { headerIdx = i; cols = found; break; }
  }
  if (!cols) {
    return { error: 'В листе ответов не нашёл колонок «Игрок» и «Приду».' };
  }

  const records = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const name = String(cell(row, cols.player)).trim();
    if (!name) continue;
    const answer = isGoingAnswer(cell(row, cols.answer));
    if (answer == null) continue;
    const date = cols.date != null ? parseGameDate(cell(row, cols.date)) : null;
    records.push({ name, answer, date, ts: String(cell(row, cols.ts)) });
  }
  if (!records.length) return { error: 'В листе ответов нет ни одного ответа.' };

  const dated = records.filter((x) => x.date);
  if (!dated.length) {
    return { error: 'Не нашёл дату игры. Добавь в форму вопрос «Дата игры».' };
  }

  const latest = dated.map((x) => x.date.key).sort().pop();
  const game = dated.filter((x) => x.date.key === latest);

  const byName = new Map();
  for (const rec of game) {
    const key = normalizeName(rec.name);
    if (key) byName.set(key, rec);
  }

  const going = [];
  const notGoing = [];
  const unknown = [];
  for (const rec of byName.values()) {
    if (rec.answer) going.push(rec.name);
    else notGoing.push(rec.name);
  }

  return {
    dateKey: latest,
    dateLabel: dated.find((x) => x.date.key === latest).date.label,
    going,
    notGoing,
    answersTotal: byName.size,
  };
}

function attendanceGoingSet() {
  if (!state.attendance) return null;
  return new Set(state.attendance.going.map(normalizeName));
}

/** Отбирает только подтвердивших явку, если включён соответствующий тумблер. */
function filterByAttendance(players) {
  const set = attendanceGoingSet();
  if (!set || !state.opts.onlyGoing) return { list: players, skipped: [] };
  const list = [];
  const skipped = [];
  for (const p of players) (set.has(normalizeName(p.name)) ? list : skipped).push(p);
  return { list, skipped };
}

/* ======================================================================
   Состояние
   ====================================================================== */

const blankState = () => ({
  players: [],
  url: '',
  attUrl: '',
  attendance: null,
  teamCount: 3,
  opts: { useGk: true, onlyGoing: false, pots: true },
});

let state = blankState();
let editingId = null;
let lastResult = null;

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      // миграция со старой версии, где была колонка «позиция»
      const old = localStorage.getItem('teambalancer.v1');
      if (old) {
        const d = JSON.parse(old);
        state = {
          players: Array.isArray(d.players) ? d.players.map(makePlayer) : [],
          url: typeof d.url === 'string' ? d.url : '',
          teamCount: d.teamCount === 2 ? 2 : 3,
          opts: { useGk: true },
        };
        saveState();
      }
      return;
    }
    const data = JSON.parse(raw);
    state = {
      players: Array.isArray(data.players) ? data.players.map(makePlayer) : [],
      url: typeof data.url === 'string' ? data.url : '',
      attUrl: typeof data.attUrl === 'string' ? data.attUrl : '',
      attendance: data.attendance && Array.isArray(data.attendance.going) ? data.attendance : null,
      teamCount: data.teamCount === 2 ? 2 : 3,
      opts: {
        useGk: data.opts ? data.opts.useGk !== false : true,
        onlyGoing: data.opts ? data.opts.onlyGoing === true : false,
        pots: data.opts ? data.opts.pots !== false : true,
      },
    };
  } catch (e) {
    state = blankState();
  }
}

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) { /* приватный режим — живём без сохранения */ }
}

/* ======================================================================
   Google Таблица
   ====================================================================== */

function buildSheetUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Пустая ссылка');

  const pub = raw.match(/\/spreadsheets\/d\/e\/([^/?#]+)/);
  if (pub) {
    const gid = (raw.match(/[?&#]gid=(\d+)/) || [])[1];
    return 'https://docs.google.com/spreadsheets/d/e/' + pub[1] + '/pub?output=csv' + (gid ? '&gid=' + gid : '');
  }

  const idm = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idm) {
    if (/^https?:\/\//i.test(raw)) return raw;
    throw new Error('Не вижу ID таблицы в ссылке');
  }

  const id = idm[1];
  const gid = (raw.match(/[?&#]gid=(\d+)/) || [])[1];
  const sheetName = decodeURIComponent((raw.match(/[?&#]sheet=([^&]+)/) || [])[1] || '');

  const params = new URLSearchParams();
  params.set('tqx', 'out:csv');
  if (gid) params.set('gid', gid);
  else if (sheetName) params.set('sheet', sheetName);
  return 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?' + params.toString();
}

async function fetchSheetText(url) {
  const res = await fetch(buildSheetUrl(url), { redirect: 'follow' });
  if (!res.ok) throw new Error('Google ответил ' + res.status);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error('Вместо CSV пришла HTML-страница — проверь доступ по ссылке');
  return text;
}

/* ======================================================================
   Черновой состав (19 игроков, оценки-заглушки)
   ====================================================================== */

function demoPlayers() {
  // имя, 6 полевых, 5 вратарских
  const rows = [
    ['Юра', 6.5, 7, 7, 6, 7, 7, 7, 7],
    ['Гриша', 7, 7.5, 5.5, 7.5, 8, 7.5, 5, 6.5],
    ['Дима Д.', 6, 5.5, 6, 7, 6, 5.5, 4.5, 5],
    ['Дима Шернук', 6.5, 5.5, 6.5, 7.5, 7.5, 8, 5.5, 3.5],
    ['Олег Л.', 7, 5.5, 7, 7.5, 6.5, 4.5, 5, 5],
    ['Олег Г.', 5, 6.5, 5.5, 6.5, 6, 5.5, 4, 3],
    ['Саша МВД', 8.5, 7, 8, 7.5, 7.5, 7.5, 6.5, 6.5],
    ['Саша МЧС', 5.5, 3, 6, 4.5, 5.5, 5, 3.5, 3],
    ['Валера', 5.5, 5.5, 6.5, 5, 6.5, 7, 4, 4.5],
    ['Денис К.', 6.5, 4.5, 5, 6.5, 6, 7.5, 5, 4.5],
    ['Веня', 5.5, 6, 7, 6.5, 5.5, 7, 3.5, 4],
    ['Антон Г', 6.5, 5, 4.5, 4.5, 6, 5.5, 4, 4.5],
    ['Антон П', 6, 6.5, 5.5, 5.5, 5.5, 5.5, 4, 4.5],
    ['Дима Казыкин', 4, 6, 5.5, 7, 7, 5, 5.5, 4],
    ['Артем', 8, 7.5, 5.5, 6, 6.5, 6.5, 5, 6],
    ['Алексей', 6.5, 6, 5, 4, 5.5, 4.5, 4, 4.5],
    ['Женя', 6, 6, 7, 6, 4, 5.5, 3.5, 3.5],
    ['Петя', 5, 5, 5, 6, 4.5, 5, 7.5, 6.5],
    ['Максим', 6, 6.5, 5, 7.5, 5.5, 5.5, 5, 4.5],
  ];

  return rows.map((r) => {
    const skills = {};
    const gk = {};
    FIELD_KEYS.forEach((k, i) => { skills[k] = r[1 + i]; });
    GK_KEYS.forEach((k, i) => { gk[k] = r[7 + i]; });
    return makePlayer({ name: r[0], skills, gk });
  });
}

/* ======================================================================
   DOM-хелперы
   ====================================================================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmt = (v) => (isNum(v) ? v.toFixed(1) : '—');

let toastTimer = null;
function toast(msg, kind) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3400);
}

/* ======================================================================
   Рендер
   ====================================================================== */

function showView(name) {
  for (const v of $$('.view')) v.hidden = v.id !== 'view-' + name;
  for (const b of $$('#tabbar button')) b.classList.toggle('on', b.dataset.view === name);
  window.scrollTo(0, 0);
}

function renderHeaderState() {
  const n = state.players.length;
  const full = prepare(state.players)
    .filter((p) => p.fieldFilled === FIELD_KEYS.length && p.gkFilled === GK_KEYS.length).length;
  const pill = $('#srcState');
  pill.textContent = n ? n + ' игроков' : 'не подключено';
  pill.className = 'pill' + (n ? ' ok' : '');
  $('#subtitle').textContent = n
    ? n + ' игроков · ' + full + ' с полными скилами · шкала 1–10'
    : 'Игроков нет — загрузи таблицу';
  const ready = $('#teamsReady');
  ready.textContent = n ? n + ' в составе' : '—';
  ready.className = 'pill' + (n ? ' ok' : '');
}

function playerNote(p) {
  const parts = [];
  const f = p.fieldFilled;
  const g = p.gkFilled;
  if (!f && !g) return 'нет скилов';
  if (f < FIELD_KEYS.length) parts.push('поле ' + f + '/' + FIELD_KEYS.length);
  if (g < GK_KEYS.length) parts.push('ворота ' + g + '/' + GK_KEYS.length);
  return parts.join(' · ');
}

function renderPlayers() {
  const ready = prepare(state.players);

  $('#playerCount').textContent = String(ready.length);

  const rated = ready.filter((p) => p.rated);
  const statsEl = $('#rosterStats');
  if (ready.length) {
    statsEl.hidden = false;
    statsEl.innerHTML =
      '<div class="stat"><b>' + ready.length + '</b><span>игроков</span></div>' +
      '<div class="stat"><b>' + fmt(rated.length ? mean(rated.map((p) => p.field)) : null) + '</b><span>средний в поле</span></div>' +
      '<div class="stat"><b>' + fmt(rated.length ? mean(rated.map((p) => p.gk)) : null) + '</b><span>средний в рамке</span></div>' +
      '<div class="stat"><b>' + ready.filter((p) => !p.rated).length + '</b><span>без оценок</span></div>';
  } else {
    statsEl.hidden = true;
    statsEl.innerHTML = '';
  }

  const sorted = ready.slice().sort((a, b) => {
    if (!a.rated) return 1;
    if (!b.rated) return -1;
    return b.field - a.field || a.name.localeCompare(b.name, 'ru');
  });

  $('#playersList').innerHTML = sorted.map((p) => {
    const note = playerNote(p);
    return '<div class="player" data-id="' + esc(p.id) + '">' +
      '<div class="p-main"><div class="p-name">' + esc(p.name) + '</div>' +
      '<div class="p-sub">' + esc(note) + '</div></div>' +
      '<span class="ov' + (p.rated ? '' : ' none') + '">' + (p.rated ? fmt(p.field) : '—') + '</span>' +
      '<span class="ov gk' + (p.rated ? '' : ' none') + '">' + (p.rated ? fmt(p.gk) : '—') + '</span>' +
      '</div>';
  }).join('');

  $('#playersEmpty').hidden = ready.length > 0;
}

function bestKeeper(team) {
  const rated = team.filter((p) => p.gkFilled > 0);
  const pool = rated.length ? rated : team;
  return pool.reduce((best, p) => (!best || p.gk > best.gk ? p : best), null);
}

function renderAttendance() {
  const pill = $('#attState');
  const box = $('#attSummary');
  const att = state.attendance;

  if (!pill || !box) return;

  if (!att) {
    pill.textContent = 'не загружена';
    pill.className = 'pill';
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const ready = prepare(state.players).filter((p) => p.rated);
  const goingSet = attendanceGoingSet();
  const notGoingSet = new Set(att.notGoing.map(normalizeName));

  const coming = ready.filter((p) => goingSet.has(normalizeName(p.name)));
  const declined = ready.filter((p) => !goingSet.has(normalizeName(p.name)) && notGoingSet.has(normalizeName(p.name)));
  const noAnswer = ready.filter((p) => !goingSet.has(normalizeName(p.name)) && !notGoingSet.has(normalizeName(p.name)));
  const unmatched = att.going.filter((n) => !ready.some((p) => normalizeName(p.name) === normalizeName(n)));

  pill.textContent = 'игра ' + att.dateLabel;
  pill.className = 'pill ok';

  box.hidden = false;
  box.innerHTML =
    '<div class="att-nums">' +
    '<div class="stat"><b>' + coming.length + '</b><span>придут</span></div>' +
    '<div class="stat"><b>' + declined.length + '</b><span>не смогут</span></div>' +
    '<div class="stat"><b>' + noAnswer.length + '</b><span>без ответа</span></div>' +
    '</div>' +
    (noAnswer.length ? '<p class="hint">Не ответили: ' + esc(noAnswer.map((p) => p.name).join(', ')) + '</p>' : '') +
    (unmatched.length ? '<p class="hint att-warn">В ответах есть имена, которых нет в составе: ' +
      esc(unmatched.join(', ')) + '</p>' : '') +
    '<button class="btn ghost small-btn" type="button" id="btnClearAtt">Сбросить явку</button>';
}

function teamCard(team, idx) {
  const meta = TEAM_META[idx % TEAM_META.length];
  const fieldSum = sum(team.map((p) => p.field));
  const gkSum = sum(team.map((p) => p.gk));
  const keeper = bestKeeper(team);

  const rows = team.slice().sort((a, b) => b.field - a.field).map((p) =>
    '<li><span class="lname">' + esc(p.name) + (state.opts.pots && p.band === 0 ? ' <b class="star">★</b>' : '') + '</span>' +
    '<span class="lov">' + fmt(p.field) + '</span>' +
    '<span class="lov gk">' + fmt(p.gk) + '</span></li>').join('');

  return '<article class="team" style="--tc:' + meta.color + '">' +
    '<div class="team-head">' +
    '<div class="team-name"><i></i>' + esc(meta.name) + '</div>' +
    '<div class="team-sum">' + fmt(fieldSum) + '<small>в поле</small></div>' +
    '</div>' +
    '<div class="team-meta">' +
    '<span class="chip">' + team.length + ' игроков</span>' +
    '<span class="chip">средний ' + fmt(fieldSum / team.length) + '</span>' +
    '<span class="chip">в рамке ' + fmt(gkSum) + '</span>' +
    (keeper ? '<span class="chip gk">🧤 ' + esc(keeper.name) + ' ' + fmt(keeper.gk) + '</span>' : '') +
    '</div>' +
    '<ul>' + rows + '</ul>' +
    '</article>';
}

function renderResult(result) {
  const wrap = $('#resultWrap');
  if (!result || result.error) {
    wrap.innerHTML = '<div class="card"><p class="muted small">' +
      esc(result ? result.error : 'Нет данных') + '</p></div>';
    return;
  }

  const avg = mean(result.fieldSums);
  const sizesArr = result.teams.map((t) => t.length);
  const sizeGap = Math.max.apply(null, sizesArr) - Math.min.apply(null, sizesArr);
  const relDiff = avg ? (result.fieldDiff / avg) * 100 : 0;

  let cls = 'good';
  let label = 'ровно';
  if (relDiff > 9) { cls = 'bad'; label = 'перекос'; }
  else if (relDiff > 3) { cls = 'warn'; label = 'приемлемо'; }
  if (result.exact) { cls = 'good'; label = 'оптимум'; }

  const warnings = [];
  if (result.excluded.length) {
    warnings.push('Без скилов и в распределение не попали: ' + result.excluded.map((p) => p.name).join(', '));
  }

  const notes = [];
  if (result.onlyGoing && result.attendance) {
    notes.push('Игра ' + result.attendance.dateLabel + ': учтены только подтвердившие явку.' +
      (result.skipped && result.skipped.length
        ? ' Не в составе: ' + result.skipped.length + ' чел.'
        : ''));
  }
  if (sizeGap) {
    notes.push('Команды разного размера (' + sizesArr.join(' / ') +
      ') — в меньшей команде игроки сильнее: это компенсация за меньшее число игроков.');
  }
  if (result.pots) {
    notes.push('Корзины: в каждой команде не больше одного игрока из верхней корзины (отмечены ★).');
  }
  notes.push(result.useGk
    ? 'Разница в рамке: ' + fmt(result.gkDiff)
    : 'Вратарская игра при балансировке не учитывалась');

  wrap.innerHTML =
    '<div class="card reveal">' +
    '<div class="result-head">' +
    '<div><div class="muted small">Разница в поле</div>' +
    '<div class="team-sum" style="color:#e8eefb">' + fmt(result.fieldDiff) +
    '<small>средний ' + fmt(avg) + '</small></div></div>' +
    '<span class="verdict ' + cls + '">' + label + '</span>' +
    '</div>' +
    notes.map((n) => '<div class="result-sub">' + esc(n) + '</div>').join('') +
    '<div class="row" style="margin-top:12px">' +
    '<button class="btn" type="button" data-act="reroll">Ещё вариант</button>' +
    '<button class="btn" type="button" data-act="share">Поделиться</button>' +
    '</div>' +
    (warnings.length ? '<div class="warnlist">' + warnings.map(esc).join('<br>') + '</div>' : '') +
    '</div>' +
    '<div class="teams reveal">' + result.teams.map((t, i) => teamCard(t, i)).join('') + '</div>';
}

/* ======================================================================
   Действия
   ====================================================================== */

function doBalance(reroll) {
  const ready = prepare(state.players).filter((p) => p.rated);
  const applied = filterByAttendance(ready);
  const eligible = applied.list;

  if (!eligible.length) {
    toast(state.opts.onlyGoing && state.attendance
      ? 'Никто не подтвердил явку на эту игру'
      : 'Игроков с оценками меньше, чем команд', 'err');
    return;
  }
  if (eligible.length < state.teamCount) {
    toast('Придут ' + eligible.length + ' — на ' + state.teamCount + ' команды мало', 'err');
    return;
  }
  if (eligible.length > 60) {
    toast('Больше 60 игроков — это уже не футбол', 'err');
    return;
  }

  const result = balance(eligible, state.teamCount, {
    useGk: state.opts.useGk,
    pots: state.opts.pots,
    exact: !reroll,
  });
  result.skipped = applied.skipped;
  result.attendance = state.attendance;
  result.onlyGoing = state.opts.onlyGoing;

  lastResult = result;
  renderResult(result);
  const wrap = $('#resultWrap');
  if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function shareResult() {
  if (!lastResult || lastResult.error) return;

  const lines = ['⚖️ ' + lastResult.teams.length + ' команды'];
  lastResult.teams.forEach((team, i) => {
    const meta = TEAM_META[i % TEAM_META.length];
    const fieldSum = sum(team.map((p) => p.field));
    const gkSum = sum(team.map((p) => p.gk));
    const keeper = bestKeeper(team);
    lines.push('');
    lines.push(meta.name + ' — в поле ' + fmt(fieldSum) + ', в рамке ' + fmt(gkSum) +
      (keeper ? ', вратарь ' + keeper.name : ''));
    team.slice().sort((a, b) => b.field - a.field).forEach((p, n) => {
      lines.push((n + 1) + '. ' + p.name + ' — ' + fmt(p.field) + ' / ' + fmt(p.gk));
    });
  });
  const text = lines.join('\n');

  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Скопировано в буфер', 'ok');
  } catch (e) {
    toast('Не удалось поделиться', 'err');
  }
}

function mergePlayers(incoming) {
  const byName = new Map(state.players.map((p) => [p.name.toLowerCase(), p]));
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const ex = byName.get(inc.name.toLowerCase());
    if (ex) {
      Object.assign(ex, inc, { id: ex.id });
      updated++;
    } else {
      state.players.push(inc);
      byName.set(inc.name.toLowerCase(), inc);
      added++;
    }
  }
  saveState();
  renderPlayers();
  renderHeaderState();
  return { added, updated };
}

/* ---------- диалог игрока ---------- */

function readPlayerForm() {
  const draft = makePlayer({ name: $('#pName').value, skills: {}, gk: {} });
  for (const k of FIELD_KEYS) {
    const el = document.querySelector('[data-skill="' + k + '"]');
    draft.skills[k] = num(el ? el.value : null);
  }
  for (const k of GK_KEYS) {
    const el = document.querySelector('[data-gk="' + k + '"]');
    draft.gk[k] = num(el ? el.value : null);
  }
  draft.name = String($('#pName').value || '').trim();
  return draft;
}

function updateOverallPreview() {
  const draft = readPlayerForm();
  const f = fieldFilled(draft);
  const g = gkFilled(draft);
  if (!f && !g) {
    $('#overallPreview').textContent = 'Скилы не заполнены — игрок не попадёт в распределение.';
    return;
  }
  const ctx = contextOf(state.players);
  $('#overallPreview').textContent =
    'В поле ' + fmt(fieldRating(draft, ctx)) + ' · в воротах ' + fmt(gkRating(draft, ctx)) +
    ' · заполнено ' + (f + g) + '/' + (FIELD_KEYS.length + GK_KEYS.length);
}

function openPlayerDialog(id) {
  editingId = id || null;
  const p = id ? state.players.find((x) => x.id === id) : null;

  $('#dlgPlayerTitle').textContent = p ? 'Игрок' : 'Новый игрок';
  $('#pName').value = p ? p.name : '';

  for (const k of FIELD_KEYS) {
    const el = document.querySelector('[data-skill="' + k + '"]');
    el.value = p && isNum(p.skills[k]) ? p.skills[k] : '';
  }
  for (const k of GK_KEYS) {
    const el = document.querySelector('[data-gk="' + k + '"]');
    el.value = p && isNum(p.gk[k]) ? p.gk[k] : '';
  }

  $('#btnDeletePlayer').hidden = !p;
  updateOverallPreview();

  const dlg = $('#dlgPlayer');
  if (!dlg.open) dlg.showModal();
  if (!p) setTimeout(() => $('#pName').focus(), 60);
}

/* ======================================================================
   Инициализация
   ====================================================================== */

function syncTeamControls() {
  for (const b of $$('#teamCount button')) {
    b.classList.toggle('on', Number(b.dataset.teams) === state.teamCount);
  }
  $('#optGk').checked = state.opts.useGk;

  const pots = $('#optPots');
  if (pots) pots.checked = state.opts.pots;

  const only = $('#optOnlyGoing');
  if (only) {
    only.checked = state.opts.onlyGoing;
    only.disabled = !state.attendance;
    const cnt = $('#goingCount');
    if (cnt) cnt.textContent = state.attendance ? String(state.attendance.going.length) : '—';
  }
}

function init() {
  loadState();

  /* --- вкладки --- */
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) showView(b.dataset.view);
  });

  /* --- источник --- */
  $('#sheetUrl').value = state.url || '';

  $('#btnLoadSheet').addEventListener('click', async () => {
    const url = $('#sheetUrl').value.trim();
    if (!url) { toast('Вставь ссылку на таблицу', 'err'); return; }

    const btn = $('#btnLoadSheet');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Загружаю…';
    try {
      const text = await fetchSheetText(url);
      const incoming = rowsToPlayers(parseCSV(text));
      if (!incoming.length) throw new Error('В таблице не нашёл ни одного игрока');

      if (state.players.length && !confirm('Заменить текущий состав (' + state.players.length +
        ' чел.) данными из таблицы (' + incoming.length + ' чел.)?')) {
        btn.disabled = false;
        btn.textContent = label;
        return;
      }

      state.players = incoming;
      state.url = url;
      saveState();
      renderPlayers();
      renderHeaderState();
      toast('Загружено: ' + incoming.length + ' игроков', 'ok');
    } catch (err) {
      const msg = err && err.message ? err.message : 'Не получилось загрузить';
      toast(/fetch|network|Failed/i.test(msg)
        ? 'Не удалось загрузить: проверь доступ по ссылке и интернет'
        : msg, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  $('#btnPaste').addEventListener('click', () => {
    $('#pasteArea').value = '';
    $('#dlgPaste').showModal();
  });

  $('#btnDemo').addEventListener('click', () => {
    if (state.players.length && !confirm('Заменить текущий состав демо-данными?')) return;
    state.players = demoPlayers();
    saveState();
    renderPlayers();
    renderHeaderState();
    toast('Демо: ' + state.players.length + ' игроков, черновые оценки', 'ok');
  });

  /* --- список игроков --- */
  $('#btnAdd').addEventListener('click', () => openPlayerDialog(null));

  $('#playersList').addEventListener('click', (e) => {
    const row = e.target.closest('.player');
    if (row) openPlayerDialog(row.dataset.id);
  });

  /* --- диалог игрока --- */
  $('#dlgPlayer').addEventListener('input', updateOverallPreview);

  $('#playerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const draft = readPlayerForm();
    if (!draft.name) { toast('Нужно имя', 'err'); return; }

    if (editingId) {
      const i = state.players.findIndex((p) => p.id === editingId);
      if (i >= 0) state.players[i] = Object.assign(draft, { id: editingId });
    } else {
      state.players.push(draft);
    }
    editingId = null;
    saveState();
    renderPlayers();
    renderHeaderState();
    $('#dlgPlayer').close();
    toast('Сохранено', 'ok');
  });

  $('#btnDeletePlayer').addEventListener('click', () => {
    if (!editingId) return;
    const p = state.players.find((x) => x.id === editingId);
    if (!p) return;
    if (!confirm('Удалить «' + p.name + '»?')) return;
    state.players = state.players.filter((x) => x.id !== editingId);
    editingId = null;
    saveState();
    renderPlayers();
    renderHeaderState();
    $('#dlgPlayer').close();
    toast('Удалён', 'ok');
  });

  /* --- CSV --- */
  $('#pasteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#pasteArea').value;
    if (!text.trim()) { toast('Пусто', 'err'); return; }
    const incoming = rowsToPlayers(parseCSV(text));
    if (!incoming.length) { toast('Не нашёл игроков в этом тексте', 'err'); return; }
    const res = mergePlayers(incoming);
    $('#dlgPaste').close();
    toast('Добавлено ' + res.added + ', обновлено ' + res.updated, 'ok');
  });

  /* --- закрытие диалогов --- */
  for (const dlg of $$('dialog')) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    for (const b of dlg.querySelectorAll('[data-close]')) {
      b.addEventListener('click', () => dlg.close());
    }
  }

  /* --- команды --- */
  $('#teamCount').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-teams]');
    if (!b) return;
    state.teamCount = Number(b.dataset.teams) === 2 ? 2 : 3;
    saveState();
    syncTeamControls();
    lastResult = null;
    $('#resultWrap').innerHTML = '';
  });

  $('#optGk').addEventListener('change', (e) => {
    state.opts.useGk = e.target.checked;
    saveState();
  });

  /* --- явка --- */
  $('#attUrl').value = state.attUrl || '';

  $('#btnLoadAtt').addEventListener('click', async () => {
    const url = $('#attUrl').value.trim();
    if (!url) { toast('Вставь ссылку на лист ответов', 'err'); return; }

    const btn = $('#btnLoadAtt');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Загружаю…';
    try {
      const text = await fetchSheetText(url);
      const parsed = parseAttendance(parseCSV(text));
      if (parsed.error) throw new Error(parsed.error);

      state.attendance = {
        dateKey: parsed.dateKey,
        dateLabel: parsed.dateLabel,
        going: parsed.going,
        notGoing: parsed.notGoing,
      };
      state.attUrl = url;
      state.opts.onlyGoing = true;
      saveState();
      renderAttendance();
      syncTeamControls();
      renderPlayers();
      renderHeaderState();
      lastResult = null;
      $('#resultWrap').innerHTML = '';
      toast('Игра ' + parsed.dateLabel + ': придут ' + parsed.going.length, 'ok');
    } catch (err) {
      const msg = err && err.message ? err.message : 'Не получилось загрузить явку';
      toast(/fetch|network|Failed/i.test(msg)
        ? 'Не удалось загрузить ответы: проверь доступ к листу и интернет'
        : msg, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  $('#attSummary').addEventListener('click', (e) => {
    const b = e.target.closest('#btnClearAtt');
    if (!b) return;
    state.attendance = null;
    state.opts.onlyGoing = false;
    saveState();
    renderAttendance();
    syncTeamControls();
    lastResult = null;
    $('#resultWrap').innerHTML = '';
    toast('Явка сброшена', 'ok');
  });

  $('#optOnlyGoing').addEventListener('change', (e) => {
    state.opts.onlyGoing = e.target.checked;
    saveState();
  });

  $('#optPots').addEventListener('change', (e) => {
    state.opts.pots = e.target.checked;
    saveState();
  });

  $('#btnBalance').addEventListener('click', () => doBalance(false));

  $('#resultWrap').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'reroll') doBalance(true);
    if (b.dataset.act === 'share') shareResult();
  });

  /* --- настройки --- */
  $('#btnClear').addEventListener('click', () => {
    if (!state.players.length) return;
    if (!confirm('Удалить всех игроков из состава?')) return;
    state.players = [];
    saveState();
    renderPlayers();
    renderHeaderState();
    lastResult = null;
    $('#resultWrap').innerHTML = '';
    toast('Состав очищен', 'ok');
  });

  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'teams-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  $('#btnImport').addEventListener('click', () => $('#fileImport').click());

  $('#fileImport').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const arr = Array.isArray(data) ? data : data.players;
        if (!Array.isArray(arr) || !arr.length) throw new Error('пусто');
        state.players = arr.map(makePlayer);
        saveState();
        renderPlayers();
        renderHeaderState();
        toast('Импортировано: ' + state.players.length, 'ok');
      } catch (err) {
        toast('Не получилось прочитать файл', 'err');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  /* --- сервис-воркер --- */
  const swEl = $('#swState');
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js')
      .then(() => { if (swEl) swEl.textContent = 'Офлайн-режим включён.'; })
      .catch(() => { if (swEl) swEl.textContent = 'Офлайн-режим недоступен (открыто без сервера).'; });
  } else if (swEl) {
    swEl.textContent = 'Офлайн-режим работает только при открытии по http(s).';
  }

  renderPlayers();
  renderHeaderState();
  renderAttendance();
  syncTeamControls();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCSV, rowsToPlayers, prepare, balance, num, makePlayer,
    contextOf, fieldRating, gkRating, fieldFilled, gkFilled,
    parseAttendance, parseGameDate, normalizeName, isGoingAnswer,
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
