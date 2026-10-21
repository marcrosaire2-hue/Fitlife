# FitPulse

Application de fitness : React (Vite) + API Node/Express + SQLite.

## Lancer en développement

```bash
npm install
npm run api    # API sur http://localhost:5181 (base SQLite créée dans server/data/)
npm run dev    # site sur http://localhost:5180 (proxy /api vers l'API)
```

## Production

```bash
npm run build
NODE_ENV=production node server/index.js   # sert aussi le site compilé
```

Variables : `PORT` (défaut 5181), `DB_FILE` (chemin de la base), `ALLOWED_ORIGINS` (origines autorisées, séparées par des virgules).

## Médias
Photos et vidéos : Pexels (licence libre) — voir `public/media/CREDITS.txt`.
