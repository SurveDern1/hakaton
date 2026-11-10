// Данные игры из data/*.json. Vite и Vitest подключают JSON при сборке,
// поэтому core читает их одинаково в браузере и в тестах.
import balance from '../../data/balance.json';
import endings from '../../data/endings.json';
import events from '../../data/events.json';
import rooms from '../../data/rooms.json';
import type { Balance, EndingsFile, EventsFile, GameData, RoomsFile } from './types';

export const gameData: GameData = {
  balance: balance as unknown as Balance,
  events: (events as unknown as EventsFile).events,
  endings: endings as unknown as EndingsFile,
  rooms: rooms as unknown as RoomsFile,
};
