-- Per-artwork 3D realization strategy chosen by the realization router
-- (supabase/functions/_shared/realization/route.ts). Nullable: older rows and
-- the demo path leave it null, and the client then uses its default behavior
-- (depth when a depth map exists, else flat).

alter table public.artworks add column if not exists realization text
  check (realization is null or realization in ('flat', 'depth', 'layered'));

alter table public.jobs add column if not exists realization text
  check (realization is null or realization in ('flat', 'depth', 'layered'));
