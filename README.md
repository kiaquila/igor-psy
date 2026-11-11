# Игорь Черкасов · частная практика

Двухстраничный сайт на HTML и CSS. Главная находится в `public/index.html`, страница о практике — в `public/practice/index.html`. Запись ведёт в Telegram с готовым текстом сообщения.

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

`wrangler.json` настраивает раздачу статических файлов и домен `igor-psy.ks-design.art`. Для деплоя нужен доступ к аккаунту Cloudflare, в котором находится зона `ks-design.art`.

```sh
npm ci
npm exec --no -- wrangler deploy
```

Игорь предоставил фотографию для главной страницы. Manrope распространяется по лицензии SIL Open Font License, текст лицензии находится рядом со шрифтами.
