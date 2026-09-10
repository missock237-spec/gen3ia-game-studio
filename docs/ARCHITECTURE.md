# GEN3IA GAME STUDIO — Architecture

Plateforme cloud-first de création de jeux 3D, accessible depuis un navigateur
(PC, tablette, Android). Ce document décrit l'architecture réellement implémentée
dans ce dépôt, module par module.

## Vue d'ensemble

```
┌────────────────────────────────────────────────────────────────────┐
│                    Navigateur (Android / tablette / PC)            │
│  ┌──────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────┐  │
│  │ Éditeur 3D   │ │ Inspector /   │ │ Monaco       │ │ Console  │  │
│  │ (Three.js)   │ │ Hiérarchie    │ │ (scripts)    │ │ / Profil │  │
│  └──────┬───────┘ └───────┬───────┘ └──────┬───────┘ └──────────┘  │
│         │   Runtime de jeu (PLAY/PAUSE/STOP + physique + IA PNJ)    │
└─────────┼──────────────────┼──────────────────┼──────────────────────┘
          │ REST (JSON)      │ WebSocket (socket.io)
┌─────────▼──────────────────▼──────────────────▼────────────────────┐
│ Next.js API routes (src/app/api)     │  game-server (mini-services) │
│ auth · projets · scènes · assets ·   │  rooms · tick 20 Hz ·        │
│ builds · scripts · snapshots · IA ·  │  snapshots 15 Hz · anti-cheat│
│ audit · rate-limiting (Zod)          │  reconnexion par token       │
└─────────┬────────────────────────────┘  └──────────────┬──────────────┘
          │ Prisma ORM                                    │
┌─────────▼─────────────┐                   ┌─────────────▼─────────────┐
│ SQLite (dev)          │                   │ Joueurs (navigateurs)     │
│ PostgreSQL (prod)     │                   └───────────────────────────┘
│ + Storage Adapter     │
│  local / Cloudflare R2│
└───────────────────────┘
```

## Modules

### 1. Éditeur 3D (`src/components/editor/`, `src/engine/renderer.ts`)
- Viewport WebGL réel (Three.js) : orbit/pan/zoom, grille, ombres, ciel, brouillard.
- Outils : sélection, déplacement, rotation, échelle, snap, focus, undo/redo,
  duplication, suppression, visibilité, verrouillage.
- Hiérarchie (arbre entités) + Inspector (transform éditable, composants).
- Profiler intégré : FPS, draw calls, triangles, qualité adaptative.

### 2. Scène & ECS (`src/engine/types.ts`, `src/engine/scene.ts`)
- Document de scène versionné (schéma Zod partagé client/serveur).
- Entités + composants : Transform, Mesh (7 primitives), Material PBR, Light
  (4 types), RigidBody, Collider, CharacterController, Player, Health, NPC,
  ParticleEmitter, Script, Camera — extensible.
- Snapshots : historique complet, restauration en un clic (API + UI).

### 3. Runtime de jeu (`src/engine/runtime.ts`, `physics.ts`, `npc-ai.ts`)
- PLAY / PAUSE / STOP / STEP / RESTART réels ; éditeur et runtime séparés.
- Physique cannon-es : gravité, masses, colliders box/sphere/capsule,
  restitution, friction, raycast sol (grounded).
- Contrôleur joueur WASD/flèches + saut (script par défaut exécuté dans le
  sandbox).
- IA PNJ hybride locale : machine à états + perception (vue/ouïe/FOV),
  patrouille, poursuite, fuite — LLM uniquement pour dialogues (voir §6).

### 4. Sandbox de scripts (`src/engine/scripting.ts`, Monaco)
- Scripts TS/JS par entité, édités dans Monaco, exécutés en PLAY dans une portée
  isolée (pas d'accès DOM/fetch/eval ; liste interdits filtrés à la compilation).
- API contrôlée : `ctx.entity` (transform, body physique, santé), `ctx.input`
  (clavier, pointeur), `ctx.world` (temps, logs), `ctx.math`, hooks
  `onStart/onUpdate/onCollision/onKey`.
- Tolérance aux pannes : erreurs attrapées par frame, script désactivé après 5
  échecs consécutifs (visible en console).

### 5. Assets (`src/app/api/projects/[id]/assets/`, `src/lib/storage.ts`)
- Upload multipart réel, validation MIME + magic bytes, checksum SHA-256,
  déduplication par clé contenu, versions (AssetVersion).
- Storage Adapter : disque local (défaut) ou Cloudflare R2 (S3-compatible via
  aws4fetch) — même interface, activation par variables d'environnement.
- Textures affichées en vignettes ; assets servis par route authentifiée.

### 6. IA (`src/lib/ai.ts`, `src/app/api/ai/`)
- Assistant de scène : message NL → LLM → commandes structurées (add/modify/
  duplicate/delete/setEnvironment) → validation Zod stricte → approbation
  humaine dans l'UI → application + snapshot automatique.
  Le texte brut du LLM n'est JAMAIS appliqué directement à la base.
- Dialogues PNJ : endpoint dédié, style contrôlé par l'archétype du PNJ.
- Les clés (HF_TOKEN / SDK serveur) restent côté serveur.

### 7. Builds (`src/lib/build-orchestrator.ts`)
- Pipeline réel : validation scène → validation scripts (compile esbuild) →
  bundle moteur (esbuild, ~717 Ko) → tests → export HTML autonome jouable
  (scène embarquée) → upload artifact → statut + logs consultables.
- Cibles : `web` (complète) et `github` (dispatch workflow GitHub Actions via
  GITHUB_TOKEN côté serveur).
- Artifact téléchargeable via route authentifiée (`/api/builds/:id/artifact`).

### 8. Multijoueur (`mini-services/game-server/index.ts`)
- Serveur AUTORITAIRE socket.io : rooms par projet/zone, tick 20 Hz, snapshots
  15 Hz, intérêt par distance, validation de vitesse (anti-téléport avec clamp),
  heartbeat + timeout, reconnexion par sessionToken (playerId restauré).
- API d'état : `GET /api/multiplayer` (rooms, joueurs, uptime, tick rate).

### 9. Auth & sécurité (`src/lib/auth.ts`, `api-utils.ts`)
- Comptes email/mot de passe (scrypt + sel), sessions httpOnly hachées (SHA-256),
  RBAC OWNER/EDITOR/VIEWER par projet, rate limiting par IP/utilisateur,
  audit log persistant (AuditEvent) sur chaque action sensible, validation Zod
  sur toutes les entrées, sanitisation des clés de stockage (anti path-traversal).

### 10. Données (`prisma/schema.prisma`)
- Tables : User, Session, Project, ProjectMember, ProjectSnapshot, Asset,
  AssetVersion, ScriptFile, Build, AIRequest, AuditEvent — index et cascades.

## Layout responsive
- Desktop : panneau gauche (hiérarchie + assets), viewport central, inspector +
  IA + multiplayer à droite, console/profiler en bas, Monaco en tiroir.
- Mobile/tactile : navigation par onglets, viewport plein écran, gestes tactiles
  (orbit = 1 doigt, pan = 2 doigts, pinch = zoom).

## Démarrage

```bash
cp .env.example .env          # SQLite par défaut — rien d'autre à faire
npm install
npx prisma db push
npm run dev                   # web + API sur :3000
cd mini-services/game-server && bun install && bun run dev   # multijoueur :3003
```

Production : `docker compose up -d` (PostgreSQL + Redis + game-server), puis
`npm run build && npm start` avec `DATABASE_URL=postgresql://…`.
