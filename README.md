# Игорь Черкасов · частная практика

Одностраничный сайт на HTML и CSS с небольшим скриптом для навигации. Все разделы находятся в `public/index.html`, шапка ведёт к ним по якорям. `public/practice/index.html` сохраняет старые ссылки: перенаправляет на главную с тем же якорем. Запись ведёт в Telegram с готовым текстом сообщения.

## Локальный просмотр

```sh
python3 -m http.server 8789 --bind 127.0.0.1 --directory public
```

Откройте `http://127.0.0.1:8789/`.

## Разработка

```sh
sh scripts/preflight.sh
```

Для слияния в `main` GitHub требует `Preflight` и `Codex Review`. Preflight проверяет страницы, обязательные файлы и скорость загрузки по базовому замеру. На GitHub он также проверяет npm-зависимости через OSV и выполняет пробную сборку Wrangler. Порядок работы с агентами, ревью и обновления базового замера описан в [инструкции по разработке](docs/development.md).

## Cloudflare Workers

GitHub Actions публикует `main` на `igor-psy.ks-design.art` после успешного `Preflight` для того же коммита. Результаты публикации и проверки сайта видны в [Production Deploy](https://github.com/kiaquila/igor-psy/actions/workflows/production-deploy.yml). Для деплоя используется окружение GitHub `production` с переменной `CLOUDFLARE_ACCOUNT_ID` и секретом `CLOUDFLARE_API_TOKEN` для Worker `igor-psy`.

`wrangler.json` настраивает раздачу статических файлов и домен `igor-psy.ks-design.art`. Для деплоя нужен доступ к аккаунту Cloudflare, в котором находится зона `ks-design.art`.

```sh
npm ci
npm exec --no -- wrangler deploy
```

Игорь предоставил фотографию для главной страницы. Manrope распространяется по лицензии SIL Open Font License, текст лицензии находится рядом со шрифтами.
