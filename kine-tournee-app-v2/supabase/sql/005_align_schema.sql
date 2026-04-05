-- Migration 005 : alignement du schéma existant avec le code V2
-- À exécuter si la BDD a été créée avec un schéma antérieur

-- ── therapist_profile ────────────────────────────────────────────────────────
ALTER TABLE public.therapist_profile ADD COLUMN IF NOT EXISTS full_name text;
UPDATE public.therapist_profile SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;

ALTER TABLE public.therapist_profile ADD COLUMN IF NOT EXISTS default_start_address text;
ALTER TABLE public.therapist_profile ADD COLUMN IF NOT EXISTS default_end_address   text;
ALTER TABLE public.therapist_profile ADD COLUMN IF NOT EXISTS default_start_lat     double precision;
ALTER TABLE public.therapist_profile ADD COLUMN IF NOT EXISTS default_start_lng     double precision;
ALTER TABLE public.therapist_profile ADD COLUMN IF NOT EXISTS default_end_lat       double precision;
ALTER TABLE public.therapist_profile ADD COLUMN IF NOT EXISTS default_end_lng       double precision;

ALTER TABLE public.therapist_profile
  ADD COLUMN IF NOT EXISTS travel_buffer_min integer NOT NULL DEFAULT 10;
ALTER TABLE public.therapist_profile
  ADD COLUMN IF NOT EXISTS session_buffer_min integer NOT NULL DEFAULT 5;

-- ── therapist_day_config ─────────────────────────────────────────────────────
-- Colonne enabled (anciennement is_working)
ALTER TABLE public.therapist_day_config
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
UPDATE public.therapist_day_config SET enabled = is_working
  WHERE is_working IS NOT NULL;

-- work_start / work_end peuvent exister mais être NULL → mettre des valeurs par défaut
ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS work_start text;
ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS work_end   text;
UPDATE public.therapist_day_config SET work_start = '08:30' WHERE work_start IS NULL;
UPDATE public.therapist_day_config SET work_end   = '18:00' WHERE work_end   IS NULL;

ALTER TABLE public.therapist_day_config
  ADD COLUMN IF NOT EXISTS blocked_windows jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.therapist_day_config
  ADD COLUMN IF NOT EXISTS max_visits integer NOT NULL DEFAULT 20;

ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS start_address text;
ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS end_address   text;
ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS start_lat     double precision;
ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS start_lng     double precision;
ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS end_lat       double precision;
ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS end_lng       double precision;

-- day_index : contrainte unique si elle n'existe pas déjà
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'therapist_day_config_day_index_key'
  ) THEN
    ALTER TABLE public.therapist_day_config ADD CONSTRAINT therapist_day_config_day_index_key UNIQUE (day_index);
  END IF;
END $$;

-- Mettre à jour day_index si NULL
UPDATE public.therapist_day_config SET day_index = CASE day_key
  WHEN 'monday'    THEN 1 WHEN 'tuesday'   THEN 2 WHEN 'wednesday' THEN 3
  WHEN 'thursday'  THEN 4 WHEN 'friday'    THEN 5 WHEN 'saturday'  THEN 6
  WHEN 'sunday'    THEN 7 END
WHERE day_index IS NULL;

-- ── patients ──────────────────────────────────────────────────────────────────
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS full_name text;
UPDATE public.patients SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;

-- S'assurer que full_name n'est pas null (fallback sur name ou 'Patient')
UPDATE public.patients SET full_name = COALESCE(name, 'Patient') WHERE full_name IS NULL;

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS notes    text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS active   boolean NOT NULL DEFAULT true;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS availability jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS session_duration_min integer NOT NULL DEFAULT 30;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS sessions_per_week    integer NOT NULL DEFAULT 2;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS lng double precision;

-- Nouvelles colonnes V2 (déjà dans 004 mais au cas où)
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS doctor_name text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS prescription_sessions_total integer;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS prescription_sessions_done  integer NOT NULL DEFAULT 0;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_fixed boolean NOT NULL DEFAULT false;
