# Kiné Tournée V2

Starter propre pour reconstruire l'application **Kiné Tournée** avec de meilleures bases.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Base de données: Supabase (PostgreSQL)
- Cartographie: à brancher ensuite (Google Maps, Mapbox, Leaflet + moteur de distance)

## Objectif métier

Générer des tournées hebdomadaires en tenant compte de:

- l'adresse de départ et d'arrivée **pour chaque jour**
- les disponibilités / indisponibilités du kiné
- les disponibilités / indisponibilités des patients
- la durée des séances
- les temps de trajet estimés

## Arborescence

- `frontend/`: interface React
- `backend/`: API Express et moteur de génération de tournée
- `supabase/sql/`: scripts SQL prêts à exécuter

## Mise en route

### 1. Supabase

Créer un projet Supabase, puis exécuter dans l'ordre:

1. `supabase/sql/001_schema.sql`
2. `supabase/sql/002_rls.sql`
3. `supabase/sql/003_seed.sql` (optionnel)

### 2. Backend

Créer `backend/.env` à partir de `.env.example`, puis:

```bash
cd backend
npm install
npm run dev
```

### 3. Frontend

Créer `frontend/.env` à partir de `.env.example`, puis:

```bash
cd frontend
npm install
npm run dev
```

## Variables d'environnement

### Frontend

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`

### Backend

- `PORT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FRONTEND_ORIGIN`

## Ce que fait déjà ce starter

- structure de données claire
- gestion des patients
- configuration hebdomadaire du kiné
- endpoint de génération de tournée
- SQL Supabase prêt à l'emploi

## Ce qu'il faudra brancher ensuite

- géocodage automatique d'adresse
- vrai moteur de distance / temps de trajet
- authentification réelle côté UI
- carte interactive
- drag & drop manuel si besoin

## Remarque importante

Le moteur de tournée fourni ici est une **base saine et simple**, pas un solveur d'optimisation avancé. Il respecte les contraintes principales et peut être amélioré ensuite.
