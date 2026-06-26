-- Per-(artwork, language, reading-level) dossier variants. The base (en, medium)
-- row is written at scan; other variants are generated on demand by the localize
-- function and cached here. Also persists the dossier (previously unpersisted).
create table if not exists public.artwork_content (
  artwork_id  uuid not null references public.artworks (id) on delete cascade,
  lang        text not null,
  level       text not null check (level in ('simple', 'medium', 'rich')),
  dossier     jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (artwork_id, lang, level)
);

alter table public.artwork_content enable row level security;
drop policy if exists "artwork_content readable" on public.artwork_content;
create policy "artwork_content readable" on public.artwork_content for select using (true);
