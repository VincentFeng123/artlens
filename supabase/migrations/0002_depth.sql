-- Depth maps for parallax/6DoF rendering.
-- The panorama generator (Blockade Model 3) returns an equirectangular depth map
-- inline; scan/index.ts re-hosts it into the public `panoramas` bucket and stores
-- the URL here. Nullable everywhere — generation never fails for lack of depth,
-- and the client falls back to in-browser depth or a flat sphere.

alter table public.artworks add column if not exists depth_url text;
alter table public.jobs     add column if not exists depth_url text;
