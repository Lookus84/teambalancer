/* Подсказки по установке под разные браузеры: node tests/browsers-test.js */
'use strict';

const path = require('path');
const T = require(path.join(__dirname, '..', 'app.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

/** Подменяем navigator на время проверки. */
function withUA(ua, platform, fn) {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: ua, platform: platform, maxTouchPoints: 0 },
  });
  try { return fn(); } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
  }
}

const UA = {
  yandexMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36',
  yandexAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Mobile Safari/537.36',
  yandexIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 YaBrowser/24.7.0.0 Safari/604.1',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  edgeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  operaMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
};

console.log('\n[1] Определение браузера');
ok('Яндекс на macOS', withUA(UA.yandexMac, 'MacIntel', () => T.browserInfo()).name === 'yandex');
ok('Яндекс на Android', withUA(UA.yandexAndroid, 'Linux', () => T.browserInfo()).name === 'yandex');
ok('Яндекс на iPhone — тоже iOS', withUA(UA.yandexIOS, 'iPhone', () => T.browserInfo()).isIOS === true);
ok('Chrome на macOS', withUA(UA.chromeMac, 'MacIntel', () => T.browserInfo()).name === 'chrome');
ok('Chrome на Android', withUA(UA.chromeAndroid, 'Linux', () => {
  const b = T.browserInfo();
  return b.name === 'chrome' && b.isAndroid;
}) === true);
ok('Safari на iPhone', withUA(UA.safariIOS, 'iPhone', () => T.browserInfo()).name === 'safari');
ok('Safari на macOS', withUA(UA.safariMac, 'MacIntel', () => T.browserInfo()).name === 'safari');
ok('Firefox на macOS', withUA(UA.firefoxMac, 'MacIntel', () => T.browserInfo()).name === 'firefox');
ok('Edge узнаётся до Chrome', withUA(UA.edgeMac, 'MacIntel', () => T.browserInfo()).name === 'edge');
ok('Opera узнаётся до Chrome', withUA(UA.operaMac, 'MacIntel', () => T.browserInfo()).name === 'opera');

console.log('\n[2] Подсказка для Яндекса');
const yandexHelp = withUA(UA.yandexMac, 'MacIntel', () => T.installHelpText(false));
ok('назван Яндекс Браузер', /Яндекс Браузер/.test(yandexHelp), yandexHelp);
ok('есть путь установки', /Установить приложение|Добавить на главный экран/.test(yandexHelp), yandexHelp);
ok('есть запасной Chrome', /Chrome/.test(yandexHelp), yandexHelp);
ok('не обещает кнопку установки', !/кнопка/i.test(yandexHelp), yandexHelp);

console.log('\n[3] Остальные браузеры');
const iosHelp = withUA(UA.safariIOS, 'iPhone', () => T.installHelpText(false));
ok('iPhone — через «Поделиться»', /Поделиться/.test(iosHelp) && /Домой/.test(iosHelp), iosHelp);
const iosYandex = withUA(UA.yandexIOS, 'iPhone', () => T.installHelpText(false));
ok('на iPhone подсказка про iOS, а не про Яндекс', /iPhone и iPad/.test(iosYandex) && !/меню ⋮/.test(iosYandex), iosYandex);
const ffHelp = withUA(UA.firefoxMac, 'MacIntel', () => T.installHelpText(false));
ok('Firefox — честно про отдельное окно', /не ставится|не ставит/.test(ffHelp), ffHelp);
const androidHelp = withUA(UA.chromeAndroid, 'Linux', () => T.installHelpText(false));
ok('Android — меню и главный экран', /Android/.test(androidHelp) && /главный экран/.test(androidHelp), androidHelp);
const chromeHelp = withUA(UA.chromeMac, 'MacIntel', () => T.installHelpText(false));
ok('компьютерный Chrome — меню ⋮', /Компьютер/.test(chromeHelp) && /⋮/.test(chromeHelp), chromeHelp);

console.log('\n[4] Уже установлено и пустой UA');
ok('установлено — подсказка не нужна', withUA(UA.chromeMac, 'MacIntel', () => T.installHelpText(true)) === '');
ok('пустой UA не ломает', (() => {
  return withUA('', '', () => T.installHelpText(false)).length > 20;
})());

console.log('\nИтог: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
