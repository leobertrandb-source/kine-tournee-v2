-- Migration 010 : préférence horaire patient (matin / après-midi / indifférent)

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS time_preference VARCHAR(20) DEFAULT 'any';
