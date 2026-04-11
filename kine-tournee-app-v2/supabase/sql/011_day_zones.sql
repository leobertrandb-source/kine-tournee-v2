-- Migration 011 : zones géographiques de tournée par jour
-- Stocke un polygone dessiné manuellement par le kiné pour contraindre
-- l'assignation des patients à chaque journée.

ALTER TABLE public.therapist_day_config ADD COLUMN IF NOT EXISTS zone_polygon JSONB;
