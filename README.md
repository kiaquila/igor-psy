# Landing Page for Psychologist Igor Cherkasov

A single-page website for Igor Cherkasov’s private psychology practice. The Forest and Yellow palette pairs deep green with warm yellow accents on a light background.

## Local preview

```sh
python3 -m http.server 8789 --bind 127.0.0.1 --directory public
```

Open `http://127.0.0.1:8789/`.

## Development

Run `sh scripts/preflight.sh` before opening a pull request. See the [development guide](docs/development.md) for the review process.

## Cloudflare Workers

GitHub Actions automatically deploys to Cloudflare Workers after a merge into `main` passes CI.
