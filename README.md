# GEN3IA GAME STUDIO

**Studio de création de jeux 3D cloud-first** — éditeur 3D dans le navigateur
(PC, tablette, Android), moteur WebGL, physique temps réel, sandbox de scripts,
IA génératrice de scènes, builds multi-cibles réels (web/APK/EXE/serveur) et
multijoueur autoritaire.

**Légende d'état** (chaque ligne est vérifiée par un test réel, pas par le code écrit) :
✅ **VERIFIED** — testé de bout en bout · 🟡 **PARTIAL** — fonctionne avec des limites documentées · ❌ **NOT SUPPORTED**

---

## État vérifié des fonctionnalités

| Module | État | Preuve / limite |
|---|---|---|
| Éditeur 3D (Three.js) | ✅ | Viewport WebGL vérifié au navigateur (desktop + mobile 390×844) : orbit/pan/zoom, gizmos, snapping, ombres, ciel, brouillard |
| Hiérarchie + Inspector | ✅ | Arbre avec recherche/filtre, multi-sélection (shift/ctrl), duplication, verrouillage, transform éditable |
| Runtime PLAY/PAUSE/STOP | ✅ | Physique cannon-es (caisses qui tombent/scatter), contrôleur WASD, scripts sans erreur — vérifié navigateur |
| Scripts sandbox | ✅ | Interdits statiques (process/fs/fetch/eval/WebSocket…), portée fermée, coupure après 5 erreurs ; `ctx.scene/time/audio/network/ui` (réels, bridges optionnels) |
| Assets | ✅ | Upload réel, **magic bytes stricts** (faux PNG rejeté 415), SVG anti-XSS, checksum SHA-256, versions, quota |
| Storage adapter | ✅ | Local par défaut ; Cloudflare R2 (SigV4 + multipart S3) quand `CLOUDFLARE_*` configuré — 23/23 assertions (put/get/URLs signées/multipart 3×5 Mo) |
| Assistant IA | ✅ | NL → commandes JSON → réparation JSON malformé LLM → validation Zod → approbation humaine → snapshot (E2E 43/43) |
| AIProvider | 🟡 | z-ai + Hugging Face, fallback/retry/circuit breaker/cache/coût/tokens/latence ; **vision** supportée (messages multimodaux), **embeddings via HF uniquement** (z-ai l'indique honnêtement) |
| IA PNJ | ✅ | Perception (FOV/ouïe), mémoire, émotions, Utility AI + Behavior Tree, steering ; **jamais de LLM par frame** ; persistance NPC/mémoires/factions (API + modèles DB) |
| Build web | ✅ | Validation → bundle esbuild → tests → HTML autonome (736 Ko vérifié) → artifact → download URL signée ; smoke test CI |
| Build dedicated-server | ✅ | zip complet (`server.js`, `world.json`, `start.sh`, `Dockerfile`, README) ; **démarrage réel testé** : world chargé, tick 19,9 Hz |
| Build Android | ✅ | **APK debug + APK release + AAB réels** (GitHub Actions, Gradle) — contenu APK inspecté : AndroidManifest + classes.dex + game.html embarqué ; signature release via secrets optionnels |
| Build Windows | ✅ | **EXE réel Node SEA** (socket.io bundlé, signature retirée avant injection) ; **smoke test de démarrage sur le runner** : stats HTTP OK |
| Build Linux | ✅ | tar.gz serveur dédié + smoke test de démarrage sur runner |
| Machine à états builds | ✅ | QUEUED→PREPARING→BUILDING→TESTING→PACKAGING→UPLOADING→COMPLETED/FAILED/CANCELLED, annulation, timeout 1 h, retry (`POST /api/builds/:id/retry`), logs live, checksum/taille/version |
| Artifact registry | ✅ | `BuildArtifact` (id, version, checksum SHA-256, taille, storageKey, expiration) ; gros binaires JAMAIS en DB ; téléchargement URL signée |
| Google Cloud Build | 🟡 | Intégration réelle complète (JWT RS256 → OAuth2 → GCS → create → poll Operation → cancel) **mais non exécutée** (aucun compte GCP fourni) ; sans config → erreur honnête listant les variables manquantes |
| Multijoueur | ✅ | Serveur autoritaire socket.io (path `/mp/`), tick 20 Hz, AOI grille 40 m + rayon configurable, anti-téléport, anti-spam, reconnexion token, zones + **handoff**, régions |
| Connexion navigateur→game-server | ✅ | Proxy `/api/mp` (polling) — connexion réelle validée au navigateur desktop **et** mobile ; en réseau ouvert, connexion websocket directe :3003 possible |
| Charge multijoueur | ✅ | Paliers **2/10/50/100/300 joueurs mesurés** : tick 19,7–20 Hz, latence p95 1→18 ms, RAM 59→143 Mo, CPU 6→25 %, 2 853 snapshots/s. **Aucune affirmation au-delà de 300 joueurs testés** |
| World streaming | ✅ | Chunks `cx/cz` (API + modèles), chargement/déchargement par rayon autour du joueur, **frustum + distance culling + LOD** (module `culling.ts`) |
| Terrain procédural | ✅ | Heightmap multi-octaves seedée, biomes, formes (plaine/collines/montagnes/îles), intégration physique |
| GitHub versioning | ✅ | Client REST réel (repos, branches, commits putFile, dispatch workflow, artifacts) ; token serveur uniquement |
| Base de données | ✅ | 27 modèles Prisma (SQLite dev / PostgreSQL prod), index/FK/cascades, `prisma validate` OK |
| Observabilité | ✅ | `/api/metrics` : users, projets, assets/bytes, builds par statut, IA 24 h (tokens/latence/coût USD), audit, chunks, **multiplayer (sonde réelle)**, CPU, RSS |
| Sécurité | ✅ | 16/16 assertions : 401 sans session, cookies HttpOnly/SameSite, RBAC inter-utilisateurs (403/404), rate limiting 429 réel, Zod scènes, magic bytes, path traversal bloqué, logout invalide la session |
| Docker | 🟡 | `docker-compose.yml` complet (PostgreSQL + Redis + game-server + app avec healthchecks + graceful shutdown, profils) — **non exécutable dans l'environnement de dev (pas de Docker) ; à tester là où Docker est disponible** |
| Mobile | ✅ | Layout tactile réel (bottom nav 7 panneaux, safe-area), viewport WebGL, gestes orbit/pan/pinch (OrbitControls), **join multijoueur validé au navigateur mobile** |
| CI | ✅ | `.github/workflows/ci.yml` : lint → typecheck strict → prisma validate → tests unitaires → build prod → **E2E complet + multijoueur + sécurité** ; 5 workflows de build tous **verts avec artifacts inspectés** |
| Client desktop natif | ❌ | Non prévu (web-first) |
| Temps réel éditeur collaboratif | ❌ | Non implémenté |
| Bases de données autres que SQLite/PostgreSQL | ❌ | Non supportées |

## Démarrage rapide

```bash
# 1. Configuration minimale (SQLite — zéro service externe)
cp .env.example .env

# 2. Dépendances + base
npm install
npx prisma db push

# 3. Lancer le studio (web + API :3000)
npm run dev

# 4. (option) Serveur multijoueur (:3003, stats :3103)
cd mini-services/game-server && bun install && bun run dev
```

Ouvrez http://localhost:3000, créez un compte, créez un projet. La scène de
départ contient sol, joueur jouable, caisses physiques, PNJ, éclairages et
fontaine à particules. ▶ pour jouer (WASD/flèches + Espace).

## Production (Docker)

```bash
docker compose up -d                    # PostgreSQL + Redis + game-server
docker compose --profile full up -d     # + app Next.js (avec healthchecks)
# app seule hors Docker : DATABASE_URL=postgresql://… npm run build && npm start
```

Environnements : **Development** (SQLite, storage local, zéro service),
**Staging/Production** (PostgreSQL, R2, Google Cloud, GitHub) — toutes les
variables sont documentées dans `.env.example`. Health checks : `GET /api/health`
(DB incluse) et `GET :3103/stats` (game-server). Graceful shutdown : SIGTERM
(app standalone + game-server, `stop_grace_period` compose).

## Builds multi-cibles

| Cible | Fournisseur | Résultat |
|---|---|---|
| `web` | **local** (toujours dispo) | HTML autonome jouable hors-ligne + manifest |
| `dedicated-server` | **local** (toujours dispo) | zip Node prêt à déployer (smoke testé) |
| `android` | GitHub Actions (ou Cloud Build) | APK debug/release + AAB (Gradle réel) |
| `windows` | GitHub Actions (`windows-latest`) | EXE Node SEA (smoke testé sur runner) |
| `linux` | GitHub Actions / Cloud Build | tar.gz serveur dédié (smoke testé sur runner) |

Les workflows `.github/workflows/build-{web,android,windows,linux,server}.yml`
sont déclenchables en `workflow_dispatch` et **tous ont réussi avec artifacts
vérifiés**. Signature Android release (optionnelle) : secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD` — jamais de clé dans Git.

Google Cloud Build : `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_REGION`,
`GOOGLE_APPLICATION_CREDENTIALS` (ou `GOOGLE_CLOUD_CREDENTIALS` base64),
`GCS_BUILD_BUCKET`. Sans configuration, les cibles natives via GCB échouent
avec la liste exacte des variables manquantes — aucun faux build.

## Multijoueur

- Serveur **autoritaire** : tick 20 Hz mesuré, snapshots 15 Hz, zones + régions + **handoff** (`zone:move`)
- AOI : grille spatiale 40 m + rayon d'intérêt configurable (`world.json → server.interestRadius`)
- Anti-cheat : clamp anti-téléport, rate limiting inputs 30 Hz, anti-spam chat, purge sessions TTL
- Reconnexion sessionToken (playerId restauré), heartbeat timeout, persistence positions optionnelle (`GAME_SERVER_PERSIST_FILE`)
- Navigateur : via proxy `/api/mp` (polling, passe derrière toute gateway) ; réseau ouvert : `ws://host:3003/mp/` direct
- Métriques : `GET :3103/stats` (tick réel, rejets, régions, mémoire)

```bash
bun scripts/test-multiplayer.ts        # 2 joueurs + anti-cheat + reconnexion
bun scripts/load-multiplayer-tiers.ts  # paliers 2/10/50/100/300 (métriques réelles)
```

## Tests (tous exécutés, résultats réels)

| Suite | Commande | Résultat |
|---|---|---|
| Unitaires | `npm test` | 14/14 (scène Zod, stockage, checksums, **réparation JSON LLM**) |
| E2E complet | `bun scripts/test-e2e-full.ts` | **43/43** — register→…→build web→artifact téléchargé |
| Multijoueur | `bun scripts/test-multiplayer.ts` | présence, clamp anti-téléport (x=500→54.2), reconnexion token |
| Charge | `bun scripts/load-multiplayer-tiers.ts` | 300 joueurs : tick 19,9 Hz, p95 18 ms, 143 Mo |
| Stockage | `bun scripts/test-storage.ts` | 23/23 — multipart réel 3×5 Mo, checksums, URLs signées |
| Sécurité | `bun scripts/test-security.ts` | 16/16 — RBAC, 429, magic bytes, traversal |
| CI GitHub | `.github/workflows/ci.yml` | lint+typecheck+build+E2E (déclenchable) |
| Builds distants | `workflow_dispatch` ×5 | **5/5 verts, artifacts inspectés** |

## Stack technique

Next.js 16 (App Router) · React 19 · TypeScript strict (0 `any` masqué, 0
`ignoreBuildErrors`) · Tailwind 4 + shadcn/ui · Zustand · Monaco · Three.js ·
cannon-es · socket.io · esbuild · Prisma (SQLite dev / PostgreSQL prod) ·
Storage Adapter (local / Cloudflare R2) · Zod partout.

## API REST (principales)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/auth/{register,login,logout}` | Comptes + sessions |
| GET/POST | `/api/projects` | Projets |
| GET/PUT | `/api/projects/:id/scene` | Scène (validée Zod) |
| GET/POST | `/api/projects/:id/npcs` · PATCH/DELETE/POST `/:npcId` | NPC + mémoires persistantes |
| GET/POST | `/api/projects/:id/factions` | Factions + réputation |
| GET/POST | `/api/projects/:id/assets` (+ `/multipart`) | Assets (simple + resumable) |
| POST/GET | `/api/projects/:id/builds` · POST `/api/builds/:id/retry` · DELETE `cancel` | Builds |
| GET | `/api/builds/:id/artifact` | Téléchargement (URL signée) |
| GET/PUT/DELETE | `/api/projects/:id/chunks` | Streaming de monde |
| POST | `/api/ai/assistant` · `/api/ai/npc-dialogue` | IA (commandes / dialogues) |
| GET | `/api/multiplayer` · `/api/metrics` · `/api/health` | État live, métriques, santé |

## Sécurité

- Secrets uniquement côté serveur (`.env`), jamais dans le bundle navigateur
- scrypt + sel pour les mots de passe ; sessions hachées SHA-256, cookies httpOnly/SameSite
- Sandbox scripts : API de surface contrôlée + interdits statiques + coupure auto
- Zod sur toutes les entrées ; magic bytes stricts ; SVG sans script ; path traversal neutralisé
- Rate limiting IP/utilisateur ; audit persistant ; RBAC OWNER/EDITOR/VIEWER
- WS : validation positions serveur, rate limiting, sessions TTL

## Limites actuelles (honnêteté oblige)

1. **Google Cloud Build** : intégration complète mais jamais exécutée (pas de compte GCP dans l'environnement de test).
2. **Docker compose** : décrit et cohérent, non exécutable ici (pas de Docker) — à valider sur un hôte Docker.
3. **Capacité multijoueur** : mesurée jusqu'à 300 clients sur l'instance de dev ; aucun chiffre au-delà n'est affirmé.
4. **WebSocket navigateur** : derrière la gateway de dev, le transport passe en polling via `/api/mp` (websocket direct possible hors gateway).
5. **Embeddings** : nécessitent `HF_TOKEN` (le provider z-ai ne les expose pas).
6. **Éditeur collaboratif temps réel** et **client natif desktop** : non implémentés.

## Licence

MIT — voir [LICENSE](LICENSE).
