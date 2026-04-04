-- Migration 004 : fiche patient complète, absences, suivi des séances

-- ── Nouvelles colonnes sur patients ──────────────────────────────────────────
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS doctor_name text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS prescription_sessions_total integer;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS prescription_sessions_done integer NOT NULL DEFAULT 0;
-- is_fixed = true : patient avec créneau horaire fixe (priorité haute dans le planning)
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_fixed boolean NOT NULL DEFAULT false;

-- ── Absences ponctuelles des patients ────────────────────────────────────────
-- Un patient peut être absent un jour précis (congés, RDV médecin, etc.)
CREATE TABLE IF NOT EXISTS public.patient_absences (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  absence_date  date        NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(patient_id, absence_date)
);

CREATE INDEX IF NOT EXISTS idx_patient_absences_patient  ON public.patient_absences(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_absences_date     ON public.patient_absences(absence_date);

-- ── Suivi des séances effectuées ─────────────────────────────────────────────
-- Une ligne par (patient × date de visite)
CREATE TABLE IF NOT EXISTS public.visit_completions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid        NOT NULL,
  visit_date  date        NOT NULL,
  done        boolean     NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(patient_id, visit_date)
);

CREATE INDEX IF NOT EXISTS idx_visit_completions_date ON public.visit_completions(visit_date);

-- ── RLS permissive (identique aux autres tables) ──────────────────────────────
ALTER TABLE public.patient_absences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "anon_all_patient_absences"
  ON public.patient_absences FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "anon_all_visit_completions"
  ON public.visit_completions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
