# GEN3IA GAME STUDIO

**Studio de création de jeux 3D cloud-first** — un véritable éditeur de jeux 3D
dans le navigateur (PC, tablette, Android) avec moteur de rendu WebGL, physique
temps réel, sandbox de scripts, IA génératrice de scènes, builds jouables et
multijoueur autoritaire. Aucune maquette : chaque fonction listée ici est
implémentée et connectée de bout en bout.

```
Éditer (Three.js) → Jouer (physique + scripts + IA PNJ) → Construire (HTML autonome) → Partager (multijoueur 20 Hz)
```

## Fonctionnalités réelles

| Module | État | Détail |
|---|---|---|
| Éditeur 3D | ✅ | Viewport WebGL, orbit/pan/zoom, gizmos, snap, undo/redo, ombres, ciel, brouillard |
| Hiérarchie + Inspector | ✅ | Arbre d'entités, transform éditable, composants (mesh, light, rigidbody, collider, NPC…) |
| Runtime de jeu | ✅ | PLAY/PAUSE/STOP/STEP/RESTART, physique cannon-es, contrôleur joueur, profiler FPS/draws |
| Scripts | ✅ | Monaco + sandbox isolé (API ctx contrôlée, coupure auto après 5 erreurs) |
| Assets | ✅ | Upload réel, validation MIME/magic bytes, checksum, versions, local ou Cloudflare R2 |
| Assistant IA | ✅ | NL → commandes structurées → validation Zod → approbation humaine → snapshot |
| IA PNJ | ✅ | Perception (vue/ouïe), patrouille/poursuite/fuite locale ; dialogues via LLM serveur |
| Builds | ✅ | Pipeline réel : validation → bundle esbuild → tests → HTML autonome jouable téléchargeable |
| GitHub | ✅ | Dispatch workflow Actions (cible `github`), push d'exports, token serveur uniquement |
| Multijoueur | ✅ | Serveur autoritaire socket.io, rooms/zones, tick 20 Hz, anti-téléport, reconnexion |
| Sécurité | ✅ | Sessions hachées httpOnly, scrypt, RBAC, rate limiting, audit log, Zod partout |
| Mobile | ✅ | Layout tactile : onglets, viewport plein écran, gestes (orbit/pan/pinch) |

## Démarrage rapide

```bash
# 1. Configuration minimale (SQLite — zéro service externe)
cp .env.example .env

# 2. Dépendances + base
npm install
npx prisma db push

# 3. Lancer le studio (web + API :3000)
npm run dev

# 4. (option) Serveur multijoueur (:3003)
cd mini-services/game-server && bun install && bun run dev
```

Ouvrez http://localhost:3000, créez un compte, créez un projet — la scène de
départ contient sol, joueur jouable, caisses physiques, PNJ, éclairages et
fontaine à particules. Appuyez sur ▶ pour jouer (WASD/flèches + Espace).

### Production (Docker)

```bash
docker compose up -d          # PostgreSQL + Redis + game-server
# puis, avec DATABASE_URL=postgresql://… :
npm run build && npm start
```


## Builds multi-cibles & fournisseurs cloud

| Cible | Fournisseur | Résultat |
|---|---|---|
| `web` | **local** (toujours disponible) | HTML autonome jouable hors-ligne + `manifest.json` |
| `dedicated-server` | **local** (toujours disponible) | zip Node prêt à déployer (`server.js`, `world.json`, `package.json`) |
| `android` | Google Cloud Build **ou** GitHub Actions | APK réel (Gradle/WebView, `scripts/packaging/package-android.sh`) |
| `windows` | GitHub Actions (runner `windows-latest`) | exe réel via Node SEA + client web |
| `linux` | GitHub Actions / Cloud Build | tar.gz serveur dédié Linux |

Machine à états complète : `QUEUED → PREPARING → BUILDING → TESTING → PACKAGING → UPLOADING → COMPLETED / FAILED / CANCELLED`,
avec annulation utilisateur, timeout global (1 h), retries, logs temps réel et
**registre d'artifacts** (`BuildArtifact`: id, version, taille, checksum SHA-256,
clé de stockage, expiration). Téléchargement via **URL signée** (R2 SigV4 ou
HMAC local). Sans configuration cloud, les cibles natives échouent avec un
message expliquant exactement les variables à fournir — aucun faux build.

Variables Google Cloud : `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_REGION`,
`GOOGLE_APPLICATION_CREDENTIALS` (ou `GOOGLE_CLOUD_CREDENTIALS` en base64),
`GCS_BUILD_BUCKET`. Variables GitHub : `GITHUB_TOKEN`. Les workflows
`.github/workflows/build-{web,android,windows,linux,server}.yml` sont fournis.

## Multijoueur MMO-ready

- Serveur **autoritaire** socket.io : rooms/zones, tick 20 Hz (mesuré), snapshots 15 Hz
- **Grille de hachage spatial** (cellules 40 m) pour l'interest management — plus de filtrage O(n²)
- Réplication des entités du monde au join (`world.json` de l'artifact serveur dédié)
- Anti-cheat : clamp anti-téléport, **rate limiting des inputs** (30 Hz) et du chat
- Reconnexion par sessionToken (playerId restauré), heartbeat + timeout
- Métriques: `/stats` (tick réel, rejets, mémoire, rooms, cellules)
- **Test de charge réel**: `bun scripts/load-multiplayer.ts 300` → 300 clients, 100 % joins, tick 19,9 Hz, ~150 Mo RAM (mesuré sur l'instance de dev)

## World streaming & terrain

- `SceneChunk` (grille `cx,cz`) : API GET/PUT/DELETE `/api/projects/:id/chunks`
- Terrain procédural réel : heightmap multi-octaves seedée, biomes de couleurs,
  formes (plaine/collines/montagnes/îles), intégration physique
- Streaming runtime : découpage par cellules, chargement/déchargement selon la
  position joueur (rayon 2 cellules), frustum culling three.js natif

## NPC AI (déterministe, locale)

- Perception (vision/FOV/ouïe), mémoire fenêtrée, émotions
- **Utility AI** (score d'actions) + **Behavior Tree** complet (sélecteur/séquence/feuilles)
- Steering (poursuite/fuite/patrouille), dialogues via LLM serveur uniquement
- Factions & réputation : API `/api/projects/:id/factions` (modèle `Faction`)

## Observabilité

- `GET /api/metrics` — users, projets, assets/bytes, builds par statut, IA 24 h
  (requêtes, erreurs, tokens, latence moyenne, coût USD estimé), audit 24 h,
  chunks, mémoire process. Scope `self` pour les utilisateurs, `admin` complet.

## Stack technique

- **Front** : Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4,
  shadcn/ui, Zustand, Monaco, Three.js, cannon-es, socket.io-client
- **API** : routes API Next.js (REST JSON), Zod, rate limiting, audit log
- **Données** : Prisma (SQLite dev / PostgreSQL prod), Storage Adapter
  (disque local ou Cloudflare R2 S3-compatible)
- **Temps réel** : socket.io — serveur de jeu autoritaire dédié (Node/Bun)
- **IA** : Hugging Face Inference Providers / z-ai-web-dev-sdk, côté serveur
  uniquement ; commandes structurées validées avant application
- **Builds** : esbuild (bundle moteur), export HTML autonome jouable hors-ligne

## API REST (extraits)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/auth/{register,login,logout}` | Comptes + sessions |
| GET/POST | `/api/projects` | Projets de l'utilisateur |
| GET/PUT | `/api/projects/:id/scene` | Document de scène (validé Zod) |
| POST/GET | `/api/projects/:id/assets` | Upload/liste d'assets (multipart) |
| GET | `/api/projects/:id/assets/:assetId/blob` | Contenu binaire authentifié |
| POST/GET | `/api/projects/:id/builds` | Lancer/lister les builds |
| GET | `/api/builds/:buildId/artifact` | Télécharger l'export jouable |
| POST/GET | `/api/projects/:id/snapshots` | Historique/restauration |
| POST/GET/PUT/DELETE | `/api/projects/:id/scripts[/:scriptId]` | Scripts projet |
| POST | `/api/ai/assistant` · `/api/ai/npc-dialogue` | IA (commandes/dialogues) |
| GET | `/api/multiplayer` | État du serveur de jeu |
| GET | `/api/health` | Sonde de santé (DB incluse) |

## Tests de véracité

Le dépôt embarque un test E2E multijoueur réel (2 clients, anti-cheat,
reconnexion) :

```bash
bun scripts/test-multiplayer.ts
```

Vérifications bout-en-bout déjà exécutées sur l'instance de développement :
inscription → création projet → édition scène → upload asset → assistant IA
(commandes validées) → build web COMPLETED (748 Ko) → téléchargement artifact →
session multijoueur (presence, clamp anti-téléport, reconnexion token).

## Sécurité

- Les secrets (AUTH_SECRET, GITHUB_TOKEN, HF_TOKEN, clés R2) ne vivent que dans
  `.env` côté serveur — jamais bundle dans le navigateur.
- Mots de passe : scrypt + sel ; sessions : token aléatoire haché SHA-256 en base,
  cookie httpOnly.
- Scripts utilisateurs : exécution navigateur dans une portée fermée, API de
  surface contrôlée, désactivation automatique en cas d'erreur en boucle.
- Toutes les entrées API passent par Zod ; audit persistant des actions sensibles ;
  rate limiting par IP et par utilisateur.

## Licence

MIT — voir [LICENSE](LICENSE).
