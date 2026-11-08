// Прогон баланса без браузера: node tools/sim.mjs [--seeds 30] [--only merciful,harsh] [--trace merciful]
// TypeScript ядра и JSON данных грузятся через Vite (runnerImport), как в игре и в тестах.
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const entry = fileURLToPath(new URL('../src/sim/report.ts', import.meta.url));
const { module } = await runnerImport(entry, { configFile: false, logLevel: 'error' });
const only = arg('only', '');
console.log(
  module.report({
    seeds: Number(arg('seeds', '30')),
    only: only ? only.split(',') : undefined,
    trace: arg('trace', undefined),
  }),
);
