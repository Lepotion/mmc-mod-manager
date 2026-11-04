# MMC Mod Manager

Менеджер модов для Cyberpunk 2077. Сделали его для себя и друзей: Vortex нам казался тяжёлым и
неудобным, хотелось чего-то попроще, но чтобы умело больше.

Интерфейс на русском и английском. Это бесплатный неофициальный фан-проект, он никак не связан
с CD PROJEKT RED или Nexus Mods.

## Как поставить

Скачай `MMC-Mod-Manager-Setup-x.x.x.exe` со страницы [Releases](https://github.com/Lepotion/mmc-mod-manager/releases/latest)
и запусти. Windows может показать синее окно SmartScreen: файл не подписан, это нормально. Жми
«Подробнее» → «Выполнить в любом случае».

При первом запуске менеджер сам найдёт игру (Steam, GOG, Epic) и предложит войти в Nexus. Без входа
тоже работает, просто моды придётся ставить из файлов.

Дальше он обновляется сам: когда выходит новая версия, слева появляется кнопка «Обновить».

## Что умеет

Моды ставятся перетаскиванием (zip, 7z, rar, .archive и т.д.) или прямо из каталога Nexus внутри
программы. Менеджер сам раскладывает файлы куда надо, включает и выключает моды одной кнопкой и
делает копии оригинальных файлов игры, так что выключенный мод не оставляет мусора.

Ещё есть:

- установщики FOMOD с выбором вариантов, как в Vortex, только с картинками;
- проверка зависимостей: если моду нужны ArchiveXL, Codeware и прочее, менеджер предложит их поставить;
- коллекции: жмёшь «Поделиться», кидаешь другу короткий код, у него ставятся те же моды;
- «Доктор»: читает логи redscript, RED4ext, CET и говорит, какой мод сломан;
- поиск виновника вылета: менеджер выключает моды по половине, ты запускаешь игру и отвечаешь
  «вылетает или нет», за несколько запусков находится сломанный мод;
- история изменений с откатом, профили, загрузки в фоне;
- отдельная вкладка для кооп-мода [NightCoop](https://nightcoop.net/).

С бесплатным аккаунтом Nexus на каждый мод нужен один клик «Slow download» на их сайте, дальше
менеджер всё делает сам. Так устроен Nexus, обойти это нельзя и не нужно. С Premium моды качаются
прямо в программе.

## Собрать из исходников

Нужен Node.js 20+.

```bash
npm install
npm start
```

Тесты: `npm test` (часть из них скачивает настоящую сборку NightCoop, нужен интернет).
Установщик: `npm run dist`, он появится в `dist/`.

Код лежит в `src/`: `core/` — вся логика (установка, Nexus, загрузки, FOMOD, «Доктор»),
`renderer/` — интерфейс, переводы в `renderer/i18n.js`.

## English

MMC Mod Manager is a free, open-source mod manager for Cyberpunk 2077 (Windows). It installs and
toggles mods, handles FOMOD installers and requirements, browses the Nexus Mods catalog, shares mod
lists as short codes (IDs only, nothing is re-uploaded) and reads framework logs to find broken mods.
API keys stay on your PC. Free Nexus accounts still click "Slow download" on the site; Premium
downloads in the app.

This is an unofficial fan project, not made or endorsed by CD PROJEKT RED or Nexus Mods.

## Лицензия

GPL-3.0, как у Vortex. Код можно брать, менять и распространять, но изменённые версии тоже должны
быть открытыми. Текст лицензии в [LICENSE](LICENSE), лицензии сторонних компонентов (7-Zip, UnRAR,
Electron и других) в `build/THIRD_PARTY_NOTICES.txt`.

© 2026 MongaManiaCorporation
