# Как выпустить новую версию

Менеджер обновляется из GitHub Releases этого репозитория (`src/config.js` → `updateRepo`).

1. Подними версию в трёх местах: `package.json` (`"version"`), `src/core/nexus.js` (`APP.version`)
   и `src/renderer/index.html` (`v1.x` в шапке).
2. `npm test`, потом `npm run dist`. Установщик появится в `dist/MMC-Mod-Manager-Setup-<версия>.exe`.
3. Закоммить и запушь изменения.
4. Выложи релиз. Через GitHub CLI:

   ```bash
   gh release create v1.7.2 dist/MMC-Mod-Manager-Setup-1.7.2.exe --title "1.7.2" --notes-file notes.md
   ```

   Или руками: https://github.com/Lepotion/mmc-mod-manager/releases/new, тег `v<версия>`, перетащить
   установщик, Publish. Галочку «pre-release» не ставить: менеджер смотрит только последний обычный релиз.

Имя файла должно содержать `Setup` и заканчиваться на `.exe`, иначе менеджер не найдёт его в релизе.
При следующем запуске у всех появится «Доступно обновление».
