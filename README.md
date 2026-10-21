# FitLife

Application de fitness : React (Vite) + API Node/Express + MongoDB.

## Lancer en développement

```bash
npm install
cp .env.example .env   # puis renseigner MONGODB_URI (jamais commité)
npm run api    # API sur http://localhost:5181 (collections MongoDB créées au démarrage)
npm run dev    # site sur http://localhost:5180 (proxy /api vers l'API)
```

## Production

```bash
npm run build
NODE_ENV=production node server/index.js   # sert aussi le site compilé
```

Variables : `MONGODB_URI` (obligatoire), `MONGODB_DB` (défaut `fitpulse`), `PORT` (défaut 5181).

## Données réelles

La base démarre **sans aucune donnée métier** : objectifs, cours, séances et coachs sont à ajouter (collections MongoDB, ou `server/catalog.json` pour objectifs/cours/séances : il est inséré au démarrage pour les `id` absents de la base). Les images/vidéos se placent dans `public/media/` et se référencent par chemin relatif (`media/photos/xxx.jpg`).

Format des documents (`_id` = identifiant texte unique) :

| Collection | Champs |
|---|---|
| `goals` | `_id`, `label`, `photo`, `position` |
| `courses` | `_id`, `name`, `photo`, `position` |
| `workouts` | `_id`, `course_id`, `title`, `minutes`, `kcal`, `level` (`Beginner` / `Intermediate` / `Advanced`), `description`, `photo`, `video`, `position`, `goals` (liste d'`_id` de `goals`), `exercises` (liste de `{name, reps, seconds}`) |
| `trainers` | `_id`, `name`, `rate`, `years`, `best` (booléen), `bio`, `photo`, `position`, `tags` (liste de textes) |

Dans `catalog.json`, la même chose s'écrit : `goals` `{id, label, photo}`, `courses` `{id, name, photo}`, `workouts` `{id, course, title, min, kcal, level, desc, photo, video, goals, ex: [[nom, reps, secondes], …]}`.

## Médias
Photos et vidéos : Pexels (licence libre) — voir `public/media/CREDITS.txt`.

> Le nom de la base MongoDB reste `fitpulse` par défaut (nom technique, sans effet pour les utilisateurs) : le renommer créerait une base vide.

## Espace administrateur

Les adresses listées dans `ADMIN_EMAILS` (séparées par des virgules) ont accès à `/admin` : aperçu, comptes (statistiques, activités et parcours de chaque utilisateur, remise à zéro, suppression), contenu (cours, séances avec vidéo YouTube/Vimeo/.mp4, objectifs, coachs) et événements à date avec liste des inscrits. Les vidéos se publient par lien : aucun fichier n'est stocké sur le serveur.

## Réseau social

Messages privés, groupes de discussion, communautés (publiques ou sur invitation, avec chat, rôles et lives programmés) et appels vidéo de groupe (WebRTC, 6 participants maximum). Le temps réel passe par un WebSocket (`/ws`, même origine que le site). Les appels exigent HTTPS (ou localhost) pour la caméra et le micro ; ajoute un serveur TURN dans `ICE_SERVERS` pour les réseaux restrictifs. L'historique de l'utilisateur est sur la page `/history`.

## Interface

Interface pensée pour le mobile uniquement (thème sombre + vert citron, d'après la maquette « Application mobile Fitness & Santé »). Sur grand écran, l'application reste une colonne centrée de 480 px.

## Déploiement

Un seul service Node sert tout : le site compilé (`dist/`), l'API `/api` et le WebSocket `/ws`. Il faut un hébergeur qui exécute un serveur Node en continu (Render, Railway, Fly…). **Vercel seul ne suffit pas** : il n'héberge que le site statique, donc l'API est absente (page de bienvenue qui ne charge pas) et le WebSocket n'existe pas.

Avec Render : « New + > Blueprint » sur ce dépôt (fichier `render.yaml`), puis renseigner `MONGODB_URI`, `ADMIN_EMAILS`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` et `VITE_ASSETS_BASE`. Dans MongoDB Atlas, autoriser l'accès réseau de l'hébergeur (Network Access, par ex. 0.0.0.0/0).
