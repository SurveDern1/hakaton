# Звуки из файлов: источники и лицензии

Все файлы собраны из паков Kenney (Kenney Vleugels, kenney.nl) под лицензией
**CC0 1.0** (https://creativecommons.org/publicdomain/zero/1.0/): можно использовать, менять и
распространять без условий, упоминание необязательно, но мы его оставляем.

| Файл | Что | Источник (пак / файл) | Обработка |
| --- | --- | --- | --- |
| `creak-metal.mp3` | Стон металла, 2,9 с | RPG Audio: `doorOpen_2.ogg` (замедлен ×0,6, полоса 90–5000 Гц) + `metalPot1.ogg` (×0,5, до 2500 Гц, −7 дБ) | Слои сложены, отражения `aecho=0.8:0.5:37\|61:0.3\|0.2` |
| `creak-wood.mp3` | Пять скрипов дерева | RPG Audio: `creak1.ogg`, `creak2.ogg`, `creak3.ogg`, `doorOpen_1.ogg` (×0,9), `creak2.ogg` (×0,82) | Фрагменты через паузу 0,25 с, отметки — `offsets` в `src/audio/samples.ts` |
| `paper-tear.mp3` | Три отрыва листка | RPG Audio: `bookFlip1.ogg` (×1,15), `bookFlip2.ogg` (×1,1), `bookFlip3.ogg` (×0,85), срез ниже 250 Гц | Как у скрипов; третий, самый короткий, после выравнивания +2 дБ (под реверберацией игры короткий кусок звучит тише) |
| `lever.mp3` | Рычаг двигателя, 0,5 с | RPG Audio: `metalClick.ogg` (×0,85) + `metalLatch.ogg` (×0,75, −6 дБ, через 50 мс) | Слои сложены |

Пак: RPG Audio, https://kenney.nl/assets/rpg-audio (zip со страницы пака, лицензия `License.txt`
в архиве — CC0). Для подбора смотрели также Impact Sounds, Interface Sounds и UI Audio того же автора
(тоже CC0) — в файлы они не вошли.

## Обработка

Скрипт `tools/make-sounds.mjs` (`npm run sounds`), параметры каждого файла — в его таблице `SOUNDS`:

1. ffmpeg декодирует источник в моно 44,1 кГц; «×0,6» — `asetrate` (высота и скорость вместе, как
   замедленная плёнка), затем фильтры из таблицы;
2. обрезка тишины по краям (порог −50 дБFS, запас 5 мс);
3. фрагменты одного файла выравниваются по громкости (LUFS той же функцией `lufs` из
   `src/audio/metrics.ts`, что мерит `npm run check:sound`) к самому тихому;
4. подъём и спад по 5 мс на краях каждого фрагмента, склейка через паузу 0,25 с;
5. нормализация всего файла к пику −3 дБFS;
6. mp3 моно 44,1 кГц 112 кбит/с без метаданных:
   `ffmpeg -i <wav> -ac 1 -ar 44100 -c:a libmp3lame -b:a 112k -map_metadata -1 <файл>.mp3`.

Пересборка (ffmpeg 9.0.2, сборка gyan.dev essentials):

```sh
# паки распаковать в папку: <KENNEY>/x-rpg-audio/…
FFMPEG=D:/Tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe KENNEY=D:/Temp/sound-dl npm run sounds
```

Сборка печатает отметки фрагментов — их переписывают в `offsets` манифеста `src/audio/samples.ts`.
Готовые mp3 лежат в git: игре, сборке и CI ни ffmpeg, ни паки не нужны. Новый файл обязан появиться в
этой таблице — `node tools/check-data.js` сверяет манифест, папку и CREDITS, а также общий размер
`public/sounds/` (не больше 300 КБ).
