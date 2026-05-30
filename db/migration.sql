-- db/migration.sql
-- PageVault: 5 tables with uuid PKs, timestamptz defaults, cascading foreign keys, indexes

-- memory_rooms: user-owned monitoring workspaces
CREATE TABLE IF NOT EXISTS memory_rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid,
  name          text NOT NULL,
  target_name   text NOT NULL,
  category      text NOT NULL DEFAULT 'competitor',
  box_folder_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- watched_urls: monitored pages per room
CREATE TABLE IF NOT EXISTS watched_urls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES memory_rooms(id) ON DELETE CASCADE,
  url        text NOT NULL,
  label      text,
  page_type  text DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- scan_runs: executions of scans over rooms
CREATE TABLE IF NOT EXISTS scan_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL REFERENCES memory_rooms(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'queued',
  apify_run_id  text,
  started_at    timestamptz,
  completed_at  timestamptz,
  error_message text
);

-- page_snapshots: captured versions of watched pages
CREATE TABLE IF NOT EXISTS page_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        uuid NOT NULL REFERENCES memory_rooms(id) ON DELETE CASCADE,
  watched_url_id uuid NOT NULL REFERENCES watched_urls(id) ON DELETE CASCADE,
  scan_run_id    uuid NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  url            text NOT NULL,
  title          text,
  text_content   text,
  content_hash   text NOT NULL,
  box_file_id    text,
  captured_at    timestamptz NOT NULL DEFAULT now()
);

-- change_analyses: AI-generated comparison results
CREATE TABLE IF NOT EXISTS change_analyses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               uuid NOT NULL REFERENCES memory_rooms(id) ON DELETE CASCADE,
  watched_url_id        uuid NOT NULL REFERENCES watched_urls(id) ON DELETE CASCADE,
  previous_snapshot_id  uuid REFERENCES page_snapshots(id),
  current_snapshot_id   uuid REFERENCES page_snapshots(id),
  severity              text NOT NULL,
  change_type           text NOT NULL,
  summary               text NOT NULL,
  business_interpretation text,
  recommended_actions   jsonb NOT NULL DEFAULT '[]',
  evidence              jsonb NOT NULL DEFAULT '[]',
  report_box_file_id    text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_watched_urls_room_id ON watched_urls(room_id);
CREATE INDEX IF NOT EXISTS idx_scan_runs_room_id ON scan_runs(room_id);
CREATE INDEX IF NOT EXISTS idx_page_snapshots_watched_url_captured ON page_snapshots(watched_url_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_change_analyses_room_created ON change_analyses(room_id, created_at DESC, id DESC);
