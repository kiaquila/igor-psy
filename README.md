# Игорь Черкасов · частная практика

Двухстраничный сайт на HTML и CSS. Главная находится в `public/index.html`, страница о практике — в `public/practice/index.html`. Запись ведёт в Telegram с готовым текстом сообщения.

## Локальный просмотр

```sh
python3 -m http.server 8789 --bind 127.0.0.1 --directory public
```

Откройте `http://127.0.0.1:8789/`.

## Cloudflare Workers

`wrangler.json` настраивает раздачу статических файлов и домен `igor-psy.ks-design.art`. Для деплоя нужен доступ к аккаунту Cloudflare, в котором находится зона `ks-design.art`.

```sh
npx wrangler@4.129.0 deploy
```

Портрет подготовлен в ImageGen по предоставленной фотографии Игоря. Manrope распространяется по лицензии SIL Open Font License, текст лицензии находится рядом со шрифтами.
