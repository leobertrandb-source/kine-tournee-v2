-- Migration 006 : ajout des colonnes manquantes détectées en production

-- updated_at sur patients (absent si la table a été créée sans ce champ)
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE public.patients SET updated_at = created_at WHERE updated_at IS NULL;
