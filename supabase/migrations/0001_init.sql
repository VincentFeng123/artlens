-- Artlens schema: artworks (cache) + jobs (async generation) + storage buckets.

create extension if not exists vector with schema extensions;

-- ── Tables ────────────────────────────────────────────────────────────────
create table if not exists public.artworks (
  id                  uuid primary key default gen_random_uuid(),
  title               text,
  artist              text,
  reference_image_url text,
  embedding           extensions.vector(1536), -- optional similarity match (unused in v1)
  scene_prompt        text,
  panorama_url        text,
  created_at          timestamptz not null default now()
);

create table if not exists public.jobs (
  id           uuid primary key default gen_random_uuid(),
  artwork_id   uuid references public.artworks (id) on delete set null,
  status       text not null default 'pending'
                 check (status in ('pending', 'generating', 'ready', 'error')),
  panorama_url text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Case-insensitive cache lookup by (title, artist).
create index if not exists artworks_title_artist_idx
  on public.artworks (lower(title), lower(artist));

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Edge Functions use the service role (bypasses RLS). The client never queries
-- these tables directly, but public SELECT is harmless (ids are uuids) and aids
-- debugging. No anon writes are permitted.
alter table public.artworks enable row level security;
alter table public.jobs enable row level security;

drop policy if exists "artworks readable" on public.artworks;
create policy "artworks readable" on public.artworks for select using (true);

drop policy if exists "jobs readable" on public.jobs;
create policy "jobs readable" on public.jobs for select using (true);

-- ── Storage buckets (public read so panoramas load as WebGL textures) ──────
insert into storage.buckets (id, name, public)
values ('reference-images', 'reference-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('panoramas', 'panoramas', true)
on conflict (id) do nothing;
