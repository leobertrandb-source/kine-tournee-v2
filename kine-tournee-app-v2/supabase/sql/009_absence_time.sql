-- Migration 009 : heure d'exclusion sur les absences ponctuelles patient
-- Permet de spécifier une plage horaire (optionnelle) sur une absence ponctuelle.
-- Sans start_time/end_time : exclusion toute la journée (comportement actuel).
-- Avec start_time/end_time : exclusion uniquement sur la plage horaire indiquée.

ALTER TABLE public.patient_absences
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME;
