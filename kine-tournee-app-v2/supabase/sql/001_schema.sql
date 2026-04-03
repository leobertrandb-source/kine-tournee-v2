create extension if not exists pgcrypto;

create table if not exists public.therapist_profile (
  id bigint primary key,
  full_name text not null default 'Kiné Demo',
  default_start_address text,
  default_end_address text,
  default_start_lat double precision,
  default_start_lng double precision,
  default_end_lat double precision,
  default_end_lng double precision,
  travel_buffer_min integer not null default 10,
  session_buffer_min integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.therapist_day_config (
  id uuid primary key default gen_random_uuid(),
  day_key text not null unique check (day_key in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  day_index integer not null unique check (day_index between 1 and 7),
  enabled boolean not null default true,
  work_start text not null default '08:30',
  work_end text not null default '18:00',
  start_address text,
  end_address text,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  max_visits integer not null default 20,
  blocked_windows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  session_duration_min integer not null default 30,
  sessions_per_week integer not null default 2,
  active boolean not null default true,
  availability jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generated_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_generated_schedules_week_start on public.generated_schedules(week_start);
create index if not exists idx_patients_active on public.patients(active);
