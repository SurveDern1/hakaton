// Проверка сна цикла Phaser (TowerScene): в покое цикл спит, новое состояние, изменение окна
// и раскрытие панели его будят, переход идёт с промежуточными кадрами, потом цикл снова засыпает.
// Запуск: node tools/check-tower-sleep.mjs (нужен Chrome или Edge, путь можно задать в CHROME).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { findChrome, sleep, waitFor } from './check-motion.mjs';
import { connect } from './perf-trace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.mts'),
  logLevel: 'error',
  server: { port: 5197, host: '127.0.0.1' },
});
await server.listen();
const base = server.resolvedUrls?.local[0];
const profile = path.join(root, 'node_modules', '.cache', 'check-tower-sleep');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
const chrome = spawn(
  findChrome(),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);
const errs = [];
const expect = (ok, what) => {
  console.log(`${ok ? 'ok ' : 'НЕТ'} ${what}`);
  if (!ok) errs.push(what);
};
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  const port = await waitFor(
    () => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').split('\n')[0],
    15000,
    'Chrome',
  );
  const pages = await waitFor(
    async () => {
      const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return l.filter((t) => t.type === 'page').length ? l : null;
    },
    10000,
    'вкладка',
  );
  const c = connect(pages.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await c.opened;
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  const size = (width, height) =>
    c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await size(390, 844);
  await c.send('Page.navigate', { url: `${base}?tutorial=end_day` });
  await waitFor(() => c.eval('!!window.sedmaya?.tower?.scene?.game?.loop'), 30000, 'сцена башни');
  await c.eval('window.sedmaya.tutorial?.coach?.hide?.()');
  const running = () => c.eval('window.sedmaya.tower.scene.game.loop.running');
  const frame = () => c.eval('window.sedmaya.tower.scene.game.loop.frame');
  const asleep = () => waitFor(async () => !(await running()), 5000, 'сон').then(() => true, () => false);

  expect(await asleep(), 'в покое цикл засыпает');

  // Новое состояние: переход с промежуточными кадрами
  await c.eval(`window.sedmaya.store.dispatch((s) => ({ ...s, mist: s.mist + 40 }))`);
  expect(await running(), 'новое состояние будит цикл');
  await waitFor(async () => (await c.eval('window.sedmaya.tower.scene.samples.at(-1)?.t')) === 1, 3000, 'конец перехода').catch(() => {});
  const samples = await c.eval('window.sedmaya.tower.scene.samples.map((s) => s.t)');
  const mid = samples.filter((t) => t > 0.05 && t < 0.95).length;
  expect(mid >= 5, `переход идёт кадрами (промежуточных ${mid})`);
  expect((samples[0] ?? 1) < 0.2, `после сна переход начинается без скачка (первый кадр t = ${(samples[0] ?? 1).toFixed(3)})`);
  expect(await asleep(), 'после перехода цикл снова засыпает');

  // Изменение окна: камера подстраивается
  const before = await c.eval('window.sedmaya.tower.scene.cameras.main.zoom');
  let f0 = await frame();
  await size(390, 600);
  await sleep(300);
  await asleep();
  const woke = (await frame()) > f0;
  const after = await c.eval('window.sedmaya.tower.scene.cameras.main.zoom');
  expect(woke && Math.abs(after - before) > 0.001, `изменение окна будит цикл и меняет масштаб (${before.toFixed(3)} → ${after.toFixed(3)})`);
  await size(390, 844);
  await asleep();

  // Отступ интерфейса меняется без изменения окна (раскрытая панель): опрос в покое будит цикл
  const y0 = await c.eval('window.sedmaya.tower.scene.cameras.main.midPoint.y');
  await c.eval(`(() => { const h = document.querySelector('#ui .hud'); h.dataset.h = h.style.height; h.style.height = (h.getBoundingClientRect().height + 120) + 'px'; })()`);
  f0 = await frame();
  await sleep(600);
  await asleep();
  const woke2 = (await frame()) > f0;
  const y1 = await c.eval('window.sedmaya.tower.scene.cameras.main.midPoint.y');
  expect(woke2 && Math.abs(y1 - y0) > 1, `отступ шапки будит цикл и сдвигает камеру (${y0.toFixed(1)} → ${y1.toFixed(1)})`);
  c.close();
} finally {
  chrome.kill();
  await server.close();
}
if (errs.length) {
  console.error(`Не прошло: ${errs.length}`);
  process.exit(1);
}
