-- Migration 008 : prénom SMS et tournée par patient

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS sms_first_name TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS tournee VARCHAR(1);
