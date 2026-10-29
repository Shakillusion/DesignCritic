-- DesignCritic AI — Postgres schema for the future Supabase adapter.
-- Mirrors src/lib/database/migrations.ts (SQLite, used locally today).
-- NOT YET WIRED UP: the app currently runs on SQLite. Row-level security
-- policies below enforce per-user isolation once Supabase Auth replaces
-- the local single-user mode.

create table brands (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  industry text not null default '',
  audience text not null default '',
  personality text not null default '',
  photography_style text not null default '',
  graphic_elements text not null default '',
  colors jsonb not null default '[]',
  typography jsonb not null default '[]',
  restrictions jsonb not null default '[]',
  logo_file_ids jsonb not null default '[]',
  reference_file_ids jsonb not null default '[]',
  guideline_file_ids jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table brand_changes (
  id text primary key,
  brand_id text not null references brands(id) on delete cascade,
  summary text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  brand_id text references brands(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table files (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text references projects(id) on delete cascade,
  brand_id text references brands(id) on delete cascade,
  kind text not null,
  original_name text not null,
  mime text not null,
  size integer not null,
  width integer,
  height integer,
  storage_path text not null, -- Supabase Storage object key
  sha256 text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index files_project on files(project_id);

create table assets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  file_id text not null references files(id),
  prepared_file_id text references files(id),
  type text not null,
  source text not null,
  provider text,
  provider_id text,
  title text not null default '',
  creator text,
  creator_url text,
  source_url text,
  license jsonb not null default '{}',
  attribution text,
  status text not null default 'approved',
  locked boolean not null default false,
  analysis jsonb not null default '{}',
  retrieved_at timestamptz,
  created_at timestamptz not null default now()
);
create index assets_project on assets(project_id);

create table designs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  brief jsonb not null default '{}',
  current_version_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table design_versions (
  id text primary key,
  design_id text not null references designs(id) on delete cascade,
  number integer not null,
  parent_version_id text,
  document jsonb not null,
  render_file_id text references files(id),
  qa jsonb,
  critique_id text,
  change_summary text not null default '',
  created_by text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (design_id, number)
);

create table asset_usages (
  asset_id text not null references assets(id) on delete cascade,
  design_version_id text not null references design_versions(id) on delete cascade,
  primary key (asset_id, design_version_id)
);

create table critiques (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  file_id text not null references files(id),
  design_version_id text references design_versions(id) on delete set null,
  brand_id text references brands(id) on delete set null,
  title text not null default '',
  status text not null,
  model text not null,
  context jsonb not null default '{}',
  technical jsonb not null default '{}',
  result jsonb,
  overall_score real,
  decisions jsonb not null default '{}',
  improvement_plan jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index critiques_project on critiques(project_id);

create table jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text references projects(id) on delete cascade,
  type text not null,
  status text not null,
  steps jsonb not null default '[]',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ai_usage (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  duration_ms integer not null default 0,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create table settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  primary key (user_id, key)
);

-- Row-level security: every row is visible only to its owner.
do $$
declare t text;
begin
  foreach t in array array['brands','projects','files','assets','designs','critiques','jobs','ai_usage','settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner', t);
  end loop;
end $$;

alter table brand_changes enable row level security;
create policy brand_changes_owner on brand_changes for all
  using (exists (select 1 from brands b where b.id = brand_id and b.user_id = auth.uid()));

alter table design_versions enable row level security;
create policy design_versions_owner on design_versions for all
  using (exists (select 1 from designs d where d.id = design_id and d.user_id = auth.uid()));

alter table asset_usages enable row level security;
create policy asset_usages_owner on asset_usages for all
  using (exists (select 1 from assets a where a.id = asset_id and a.user_id = auth.uid()));

-- Phase 3 (mirrors SQLite migration 2)
alter table design_versions add column changes jsonb not null default '[]';
alter table designs add column source_file_id text;

create table chat_messages (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  design_id text,
  role text not null,
  content text not null,
  action jsonb,
  created_at timestamptz not null default now()
);
create index chat_project on chat_messages(project_id, created_at);
alter table chat_messages enable row level security;
create policy chat_messages_owner on chat_messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Phase 4 (mirrors SQLite migration 3)
create table research_runs (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, project_id text not null references projects(id) on delete cascade, query jsonb not null, items jsonb not null default '[]', brief jsonb, source_errors jsonb not null default '[]', created_at timestamptz not null default now());
create table refs (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, project_id text not null references projects(id) on delete cascade, kind text not null, source text not null, title text not null, url text not null, published_at timestamptz, creator text, summary text not null default '', rights text, file_id text references files(id) on delete set null, palette jsonb not null default '[]', notes text not null default '', research_run_id text, created_at timestamptz not null default now(), unique (project_id, url));
create table moodboards (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, project_id text not null references projects(id) on delete cascade, name text not null, notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table moodboard_items (moodboard_id text not null references moodboards(id) on delete cascade, ref_id text not null references refs(id) on delete cascade, position integer not null, size text not null default 'm', note text not null default '', primary key (moodboard_id, ref_id));
create table directions (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, project_id text not null references projects(id) on delete cascade, moodboard_id text references moodboards(id) on delete set null, data jsonb not null, created_at timestamptz not null default now());
do $$ declare t text; begin
  foreach t in array array['research_runs','refs','moodboards','directions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner', t);
  end loop;
end $$;
alter table moodboard_items enable row level security;
create policy moodboard_items_owner on moodboard_items for all using (exists (select 1 from moodboards m where m.id = moodboard_id and m.user_id = auth.uid()));
