insert into public.therapist_profile (
  id,
  full_name,
  default_start_address,
  default_end_address,
  default_start_lat,
  default_start_lng,
  default_end_lat,
  default_end_lng,
  travel_buffer_min,
  session_buffer_min
)
values (
  1,
  'Sophie Martin',
  '12 rue de la Paix, Paris',
  '12 rue de la Paix, Paris',
  48.8698,
  2.3309,
  48.8698,
  2.3309,
  10,
  5
)
on conflict (id) do update set
  full_name = excluded.full_name;

insert into public.therapist_day_config (
  day_key, day_index, enabled, work_start, work_end, start_address, end_address, max_visits, blocked_windows
)
values
  ('monday', 1, true, '08:30', '18:00', '12 rue de la Paix, Paris', '12 rue de la Paix, Paris', 8, '[{"start_time":"12:30","end_time":"13:30"}]'::jsonb),
  ('tuesday', 2, true, '08:30', '18:00', '12 rue de la Paix, Paris', 'Cabinet Paris 15', 8, '[{"start_time":"12:30","end_time":"13:30"}]'::jsonb),
  ('wednesday', 3, true, '08:30', '18:00', 'Cabinet Paris 15', 'Cabinet Paris 15', 8, '[{"start_time":"12:30","end_time":"13:30"}]'::jsonb),
  ('thursday', 4, true, '08:30', '18:00', '12 rue de la Paix, Paris', '12 rue de la Paix, Paris', 8, '[{"start_time":"12:30","end_time":"13:30"}]'::jsonb),
  ('friday', 5, true, '08:30', '17:00', '12 rue de la Paix, Paris', '12 rue de la Paix, Paris', 6, '[{"start_time":"12:30","end_time":"13:30"}]'::jsonb),
  ('saturday', 6, false, '08:30', '12:00', null, null, 0, '[]'::jsonb),
  ('sunday', 7, false, '08:30', '12:00', null, null, 0, '[]'::jsonb)
on conflict (day_key) do update set
  enabled = excluded.enabled,
  work_start = excluded.work_start,
  work_end = excluded.work_end;

insert into public.patients (
  full_name,
  address,
  lat,
  lng,
  session_duration_min,
  sessions_per_week,
  active,
  availability,
  notes
)
values
  (
    'Marie Dubois',
    'Montmartre, Paris 18',
    48.886,
    2.343,
    30,
    2,
    true,
    '{"monday":{"unavailable":false,"available_windows":[{"start_time":"09:00","end_time":"12:00"}],"blocked_windows":[]},"tuesday":{"unavailable":true},"wednesday":{"unavailable":false,"available_windows":[{"start_time":"14:00","end_time":"17:00"}],"blocked_windows":[]}}'::jsonb,
    'Disponible surtout début de semaine'
  ),
  (
    'Jean Martin',
    'Bastille, Paris 11',
    48.853,
    2.369,
    45,
    3,
    true,
    '{"monday":{"unavailable":false,"available_windows":[{"start_time":"10:00","end_time":"16:00"}],"blocked_windows":[]},"thursday":{"unavailable":false,"available_windows":[{"start_time":"08:30","end_time":"11:30"}],"blocked_windows":[]},"friday":{"unavailable":true}}'::jsonb,
    'Préférer matin ou début après-midi'
  );
