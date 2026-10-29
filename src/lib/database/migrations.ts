/**
 * SQLite schema. Each entry runs once, in order, tracked by PRAGMA user_version.
 * Postgres equivalent for the future Supabase adapter: supabase/migrations/0001_init.sql
 */
export const MIGRATIONS: string[] = [
  /* 1 — initial schema */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE brands (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    photography_style TEXT NOT NULL DEFAULT '',
    graphic_elements TEXT NOT NULL DEFAULT '',
    colors TEXT NOT NULL DEFAULT '[]',
    typography TEXT NOT NULL DEFAULT '[]',
    restrictions TEXT NOT NULL DEFAULT '[]',
    logo_file_ids TEXT NOT NULL DEFAULT '[]',
    reference_file_ids TEXT NOT NULL DEFAULT '[]',
    guideline_file_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE brand_changes (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    storage_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX files_project ON files(project_id);

  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id),
    prepared_file_id TEXT REFERENCES files(id),
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    provider TEXT,
    provider_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    creator TEXT,
    creator_url TEXT,
    source_url TEXT,
    license TEXT NOT NULL DEFAULT '{}',
    attribution TEXT,
    status TEXT NOT NULL DEFAULT 'approved',
    locked INTEGER NOT NULL DEFAULT 0,
    analysis TEXT NOT NULL DEFAULT '{}',
    retrieved_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX assets_project ON assets(project_id);

  CREATE TABLE designs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '{}',
    current_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX designs_project ON designs(project_id);

  CREATE TABLE design_versions (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    parent_version_id TEXT,
    document TEXT NOT NULL,
    render_file_id TEXT REFERENCES files(id),
    qa TEXT,
    critique_id TEXT,
    change_summary TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(design_id, number)
  );

  CREATE TABLE asset_usages (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    design_version_id TEXT NOT NULL REFERENCES design_versions(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, design_version_id)
  );

  CREATE TABLE critiques (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id),
    design_version_id TEXT REFERENCES design_versions(id) ON DELETE SET NULL,
    brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    model TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '{}',
    technical TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    overall_score REAL,
    decisions TEXT NOT NULL DEFAULT '{}',
    improvement_plan TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX critiques_project ON critiques(project_id);

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE ai_usage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  `,
  /* 2 — Phase 3: per-version change lists, rebuilt-design provenance, assistant chat */ `
  ALTER TABLE design_versions ADD COLUMN changes TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE designs ADD COLUMN source_file_id TEXT;

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    design_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    action TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX chat_project ON chat_messages(project_id, created_at);
  `,
  /* 3 — Phase 4: research runs, saved references, moodboards, art directions */ `
  CREATE TABLE research_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    brief TEXT,
    source_errors TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX research_project ON research_runs(project_id, created_at);

  CREATE TABLE refs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TEXT,
    creator TEXT,
    summary TEXT NOT NULL DEFAULT '',
    rights TEXT,
    file_id TEXT REFERENCES files(id),
    palette TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    research_run_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, url)
  );

  CREATE TABLE moodboards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE moodboard_items (
    moodboard_id TEXT NOT NULL REFERENCES moodboards(id) ON DELETE CASCADE,
    ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    size TEXT NOT NULL DEFAULT 'm',
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (moodboard_id, ref_id)
  );

  CREATE TABLE directions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    moodboard_id TEXT REFERENCES moodboards(id) ON DELETE SET NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];
