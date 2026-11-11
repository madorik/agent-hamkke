import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  agent_kind TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,            -- human | agent
  agent_kind TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'request',
  turn_limit INTEGER NOT NULL DEFAULT 8,
  require_approval INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  channel_id TEXT NOT NULL REFERENCES channels(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  agent_enabled INTEGER NOT NULL DEFAULT 1,
  joined_at INTEGER NOT NULL,
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  author_id TEXT,
  author_kind TEXT NOT NULL,     -- human | agent | system
  agent_kind TEXT,
  visibility TEXT NOT NULL,      -- channel | private
  status TEXT NOT NULL,          -- sent | pending | rejected
  kind TEXT NOT NULL,            -- text | system | artifact
  body TEXT NOT NULL,
  artifact_id TEXT,
  artifact_version INTEGER,
  edited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages (channel_id, created_at);
CREATE INDEX IF NOT EXISTS messages_pending ON messages (author_id, status);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  final_version INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_versions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  agent_kind TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, version)
);

CREATE TABLE IF NOT EXISTS finalizations (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, version, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  uploader_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_preview TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`

export function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)
  // 예전 DB 에 없는 열 추가
  const cols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'file_id')) db.exec('ALTER TABLE messages ADD COLUMN file_id TEXT')
  // 시스템 메시지의 이벤트(JSON). 보는 사람 언어로 문장을 만든다.
  if (!cols.some((c) => c.name === 'event')) db.exec('ALTER TABLE messages ADD COLUMN event TEXT')
  // @이름 으로 지목한 참여자(JSON 배열)
  if (!cols.some((c) => c.name === 'mentions')) db.exec('ALTER TABLE messages ADD COLUMN mentions TEXT')
  // 항상 모두 승인(사람별)
  const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
  if (!userCols.some((c) => c.name === 'auto_approve')) db.exec('ALTER TABLE users ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0')
  return db
}

export type Row = Record<string, string | number | null>
