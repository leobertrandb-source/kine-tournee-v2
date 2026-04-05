-- Migration 007 : multi-tenancy — isolation des données par utilisateur

-- ── Ajout user_id sur toutes les tables ──────────────────────────────────────
ALTER TABLE public.patients              ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.therapist_profile     ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.therapist_day_config  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.generated_schedules   ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.patient_absences      ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.visit_completions     ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- ── Assigner les données existantes au premier utilisateur inscrit ────────────
-- (à exécuter si vous aviez déjà des données avant cette migration)
DO $$
DECLARE first_user_id uuid;
BEGIN
  SELECT id INTO first_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF first_user_id IS NOT NULL THEN
    UPDATE public.patients             SET user_id = first_user_id WHERE user_id IS NULL;
    UPDATE public.therapist_profile    SET user_id = first_user_id WHERE user_id IS NULL;
    UPDATE public.therapist_day_config SET user_id = first_user_id WHERE user_id IS NULL;
    UPDATE public.generated_schedules  SET user_id = first_user_id WHERE user_id IS NULL;
    UPDATE public.patient_absences     SET user_id = first_user_id WHERE user_id IS NULL;
    UPDATE public.visit_completions    SET user_id = first_user_id WHERE user_id IS NULL;
  END IF;
END $$;

-- ── Contrainte unique (user_id, day_key) pour therapist_day_config ───────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'therapist_day_config_user_day_key'
  ) THEN
    ALTER TABLE public.therapist_day_config
      ADD CONSTRAINT therapist_day_config_user_day_key UNIQUE (user_id, day_key);
  END IF;
END $$;

-- ── Contrainte unique user_id pour therapist_profile ─────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'therapist_profile_user_id_key'
  ) THEN
    ALTER TABLE public.therapist_profile
      ADD CONSTRAINT therapist_profile_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- ── Supprimer les anciennes politiques permissives ────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patients' AND policyname='anon_all') THEN
    DROP POLICY "anon_all" ON public.patients; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='therapist_profile' AND policyname='anon_all') THEN
    DROP POLICY "anon_all" ON public.therapist_profile; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='therapist_day_config' AND policyname='anon_all') THEN
    DROP POLICY "anon_all" ON public.therapist_day_config; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='generated_schedules' AND policyname='anon_all') THEN
    DROP POLICY "anon_all" ON public.generated_schedules; END IF;
END $$;

-- ── Nouvelles politiques RLS par utilisateur ──────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patients' AND policyname='user_own_patients') THEN
    CREATE POLICY "user_own_patients" ON public.patients
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='therapist_profile' AND policyname='user_own_profile') THEN
    CREATE POLICY "user_own_profile" ON public.therapist_profile
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='therapist_day_config' AND policyname='user_own_day_config') THEN
    CREATE POLICY "user_own_day_config" ON public.therapist_day_config
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='generated_schedules' AND policyname='user_own_schedules') THEN
    CREATE POLICY "user_own_schedules" ON public.generated_schedules
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patient_absences' AND policyname='user_own_patient_absences') THEN
    DROP POLICY IF EXISTS "anon_all_patient_absences" ON public.patient_absences;
    CREATE POLICY "user_own_patient_absences" ON public.patient_absences
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='visit_completions' AND policyname='user_own_visit_completions') THEN
    DROP POLICY IF EXISTS "anon_all_visit_completions" ON public.visit_completions;
    CREATE POLICY "user_own_visit_completions" ON public.visit_completions
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
