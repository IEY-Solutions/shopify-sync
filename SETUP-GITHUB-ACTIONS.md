# Pasar el sync a GitHub Actions (gratis, 24/7, repo público)

Checklist para la próxima sesión. El workflow ya está listo en `.github/workflows/sync.yml`
(corre `node src/index.js` cada 5 min en la nube).

## 1. Crear el repositorio en GitHub
- Cuenta en https://github.com (si no tenés).
- Crear un repo **público** llamado `iey-shopify-sync` (vacío, sin README).

## 2. Subir el código
Desde la carpeta del proyecto, en la terminal:
```bash
git init
git add -A
git status            # VERIFICAR que .env NO aparezca en la lista
git commit -m "Middleware sync stock Contabilium -> Shopify"
git branch -M main
git remote add origin https://github.com/<TU-USUARIO>/iey-shopify-sync.git
git push -u origin main
```
> El `.gitignore` ya excluye `.env`, `node_modules/`, `.cache/` y `*.log`. Igual,
> confirmá con `git status` que el `.env` no se sube (es público, ojo).

## 3. Cargar los secretos
En el repo: **Settings → Secrets and variables → Actions → New repository secret**.
Crear estos 9 (los valores salen de tu `.env`):

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_DOT_LOCATION_ID`
- `CONTABILIUM_API_URL`
- `CONTABILIUM_CLIENT_ID`
- `CONTABILIUM_CLIENT_SECRET`
- `CONTABILIUM_DOT_DEPOSITO_ID`

(El `DRY_RUN` ya va fijo en `false` dentro del workflow; no hace falta cargarlo.)

## 4. Primera corrida
- Pestaña **Actions** → habilitar workflows si lo pide.
- Elegir "Sync stock Contabilium -> Shopify" → **Run workflow** (corre a mano).
- La PRIMERA tarda ~26 min (siembra la libreta). Las siguientes, ~1 min.

## 5. Apagar el pm2 de la Mac (importante)
Para que NO corran los dos a la vez (Mac + nube) y se pisen:
```bash
pm2 delete iey-shopify-sync
pm2 save
```

## Notas
- Repo público = minutos de Actions ilimitados y gratis.
- La programación de GitHub puede atrasarse algunos minutos según su carga.
- Para ver corridas y logs: pestaña **Actions** del repo.
