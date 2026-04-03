alter table public.therapist_profile enable row level security;
alter table public.therapist_day_config enable row level security;
alter table public.patients enable row level security;
alter table public.generated_schedules enable row level security;

create policy "public read therapist_profile"
on public.therapist_profile
for select
to anon, authenticated
using (true);

create policy "public write therapist_profile"
on public.therapist_profile
for all
to anon, authenticated
using (true)
with check (true);

create policy "public read therapist_day_config"
on public.therapist_day_config
for select
to anon, authenticated
using (true);

create policy "public write therapist_day_config"
on public.therapist_day_config
for all
to anon, authenticated
using (true)
with check (true);

create policy "public read patients"
on public.patients
for select
to anon, authenticated
using (true);

create policy "public write patients"
on public.patients
for all
to anon, authenticated
using (true)
with check (true);

create policy "public read generated_schedules"
on public.generated_schedules
for select
to anon, authenticated
using (true);

create policy "public write generated_schedules"
on public.generated_schedules
for all
to anon, authenticated
using (true)
with check (true);
