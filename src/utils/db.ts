import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pipeline_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS file_hashes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  stage TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS distill_iterations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration INTEGER NOT NULL,
  track TEXT NOT NULL,
  persona_snapshot TEXT NOT NULL,
  score REAL,
  created_at TEXT NOT NULL
);
`;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const config = loadConfig();
  const dbDir = config.workspaceDir;
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'sbs.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.exec(SCHEMA);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ---------- Pipeline State helpers ----------

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PipelineRow {
  id: number;
  stage: string;
  status: StageStatus;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  metadata: string | null;
}

export function getStageStatus(stage: string): PipelineRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM pipeline_state WHERE stage = ? ORDER BY id DESC LIMIT 1').get(stage) as PipelineRow | undefined;
}

export function setStageRunning(stage: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO pipeline_state (stage, status, started_at) VALUES (?, ?, datetime(\'now\'))'
  ).run(stage, 'running');
}

export function setStageCompleted(stage: string, metadata?: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE pipeline_state SET status = 'completed', completed_at = datetime('now'), metadata = ?
     WHERE stage = ? AND status = 'running'`
  ).run(metadata ?? null, stage);
}

export function setStageFailed(stage: string, error: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE pipeline_state SET status = 'failed', completed_at = datetime('now'), error_message = ?
     WHERE stage = ? AND status = 'running'`
  ).run(error, stage);
}

// ---------- File hash helpers ----------

export function getFileHash(filePath: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT hash FROM file_hashes WHERE file_path = ?').get(filePath) as { hash: string } | undefined;
  return row?.hash;
}

export function setFileHash(filePath: string, hash: string, stage: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO file_hashes (file_path, hash, stage, processed_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(file_path) DO UPDATE SET hash = ?, stage = ?, processed_at = datetime('now')`
  ).run(filePath, hash, stage, hash, stage);
}
