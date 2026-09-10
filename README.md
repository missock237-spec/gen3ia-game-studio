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
