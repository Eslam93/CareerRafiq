import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const MIGRATIONS: readonly string[] = [
  `
    CREATE TABLE IF NOT EXISTS __career_rafiq_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT,
      account_status TEXT NOT NULL,
      email_verification_status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      access_level TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

    CREATE TABLE IF NOT EXISTS magic_link_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS magic_link_tokens_user_id_idx ON magic_link_tokens (user_id);
    CREATE INDEX IF NOT EXISTS magic_link_tokens_email_idx ON magic_link_tokens (email);

    CREATE TABLE IF NOT EXISTS email_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      email TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_outbox_email_idx ON email_outbox (email, created_at);

    CREATE TABLE IF NOT EXISTS cvs (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      extracted_email TEXT,
      processing_status TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cvs_user_id_idx ON cvs (user_id, uploaded_at);

    CREATE TABLE IF NOT EXISTS cv_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      cv_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cv_profiles_user_id_idx ON cv_profiles (user_id);

    CREATE TABLE IF NOT EXISTS preference_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      source_identifier TEXT NOT NULL,
      source_url TEXT,
      source_url_key TEXT,
      probable_duplicate_key TEXT,
      job_extraction_state TEXT NOT NULL,
      extraction_confidence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_user_id_idx ON jobs (user_id, updated_at);
    CREATE INDEX IF NOT EXISTS jobs_source_url_idx ON jobs (user_id, source_url_key);
    CREATE INDEX IF NOT EXISTS jobs_probable_duplicate_idx ON jobs (user_id, probable_duplicate_key);

    CREATE TABLE IF NOT EXISTS job_extractions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL UNIQUE,
      source_identifier TEXT NOT NULL,
      source_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS job_extractions_user_id_idx ON job_extractions (user_id);

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      active INTEGER NOT NULL,
      evaluation_version TEXT NOT NULL,
      scoring_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evaluations_job_id_idx ON evaluations (job_id, created_at);
    CREATE INDEX IF NOT EXISTS evaluations_active_idx ON evaluations (job_id, active);

    CREATE TABLE IF NOT EXISTS tracker_items (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL UNIQUE,
      current_status TEXT NOT NULL,
      recommended_cv_decision TEXT NOT NULL,
      verdict_decision TEXT NOT NULL,
      selected_cv_id TEXT,
      next_action_code TEXT,
      active_evaluation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tracker_items_user_id_idx ON tracker_items (user_id, updated_at);
    CREATE INDEX IF NOT EXISTS tracker_items_recommended_cv_decision_idx ON tracker_items (user_id, recommended_cv_decision);
    CREATE INDEX IF NOT EXISTS tracker_items_verdict_decision_idx ON tracker_items (user_id, verdict_decision);
    CREATE INDEX IF NOT EXISTS tracker_items_selected_cv_idx ON tracker_items (user_id, selected_cv_id);
    CREATE INDEX IF NOT EXISTS tracker_items_next_action_idx ON tracker_items (user_id, next_action_code);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analytics_events_name_idx ON analytics_events (name);
    CREATE INDEX IF NOT EXISTS analytics_events_user_id_idx ON analytics_events (user_id, timestamp);
  `,
];

function nowIso(): string {
  return new Date().toISOString();
}

function hasColumn(sqlite: Database.Database, tableName: string, columnName: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function addTrackerTrustColumns(sqlite: Database.Database): void {
  if (!hasColumn(sqlite, 'tracker_items', 'recommended_cv_decision')) {
    sqlite.exec(`ALTER TABLE tracker_items ADD COLUMN recommended_cv_decision TEXT NOT NULL DEFAULT 'pending';`);
  }
  if (!hasColumn(sqlite, 'tracker_items', 'verdict_decision')) {
    sqlite.exec(`ALTER TABLE tracker_items ADD COLUMN verdict_decision TEXT NOT NULL DEFAULT 'pending';`);
  }
  if (!hasColumn(sqlite, 'tracker_items', 'selected_cv_id')) {
    sqlite.exec(`ALTER TABLE tracker_items ADD COLUMN selected_cv_id TEXT;`);
  }
  if (!hasColumn(sqlite, 'tracker_items', 'next_action_code')) {
    sqlite.exec(`ALTER TABLE tracker_items ADD COLUMN next_action_code TEXT;`);
  }

  sqlite.exec(`
    UPDATE tracker_items
    SET
      recommended_cv_decision = COALESCE(json_extract(data, '$.recommendedCvDecision'), recommended_cv_decision, 'pending'),
      verdict_decision = COALESCE(json_extract(data, '$.verdictDecision'), verdict_decision, 'pending'),
      selected_cv_id = COALESCE(json_extract(data, '$.userSelectedCvId'), selected_cv_id),
      next_action_code = COALESCE(json_extract(data, '$.nextActionSnapshot.code'), next_action_code)
  `);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS tracker_items_recommended_cv_decision_idx ON tracker_items (user_id, recommended_cv_decision);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tracker_items_verdict_decision_idx ON tracker_items (user_id, verdict_decision);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tracker_items_selected_cv_idx ON tracker_items (user_id, selected_cv_id);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tracker_items_next_action_idx ON tracker_items (user_id, next_action_code);`);
}

function createAiArtifactsTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ai_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      related_entity_type TEXT NOT NULL,
      related_entity_id TEXT NOT NULL,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      cache_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS ai_artifacts_user_id_idx ON ai_artifacts (user_id, created_at);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS ai_artifacts_entity_idx ON ai_artifacts (related_entity_type, related_entity_id, created_at);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS ai_artifacts_step_type_idx ON ai_artifacts (user_id, step_type, created_at);`);
}

function createEyeDiagnosticsTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS eye_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      operator_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_event_at TEXT,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS eye_sessions_operator_user_id_idx ON eye_sessions (operator_user_id, updated_at);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS eye_sessions_status_idx ON eye_sessions (operator_user_id, status);`);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id TEXT PRIMARY KEY NOT NULL,
      eye_session_id TEXT,
      request_id TEXT,
      user_id TEXT,
      job_id TEXT,
      tracker_item_id TEXT,
      area TEXT NOT NULL,
      severity TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS diagnostic_events_eye_session_id_idx ON diagnostic_events (eye_session_id, created_at);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS diagnostic_events_request_id_idx ON diagnostic_events (request_id, created_at);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS diagnostic_events_user_id_idx ON diagnostic_events (user_id, created_at);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS diagnostic_events_area_idx ON diagnostic_events (area, created_at);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS diagnostic_events_severity_idx ON diagnostic_events (severity, created_at);`);
}

function createCvVersionsTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS cv_versions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      cv_id TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      superseded_at TEXT,
      data TEXT NOT NULL
    );
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS cv_versions_cv_id_idx ON cv_versions (cv_id, uploaded_at);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS cv_versions_user_id_idx ON cv_versions (user_id, uploaded_at);`);
}

export function ensureDatabaseDirectory(filePath: string): string {
  const resolved = resolve(filePath);
  mkdirSync(dirname(resolved), { recursive: true });
  return resolved;
}

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(MIGRATIONS[0]!);
  const initialVersion = '0001_initial';
  const initialApplied = sqlite
    .prepare('SELECT version FROM __career_rafiq_migrations WHERE version = ? LIMIT 1')
    .get(initialVersion) as { version: string } | undefined;
  if (!initialApplied) {
    sqlite.exec(MIGRATIONS[1]!);
    sqlite
      .prepare('INSERT INTO __career_rafiq_migrations (version, applied_at) VALUES (?, ?)')
      .run(initialVersion, nowIso());
  }

  const trackerTrustVersion = '0002_tracker_trust_workflow';
  const trackerTrustApplied = sqlite
    .prepare('SELECT version FROM __career_rafiq_migrations WHERE version = ? LIMIT 1')
    .get(trackerTrustVersion) as { version: string } | undefined;
  if (!trackerTrustApplied) {
    addTrackerTrustColumns(sqlite);
    sqlite
      .prepare('INSERT INTO __career_rafiq_migrations (version, applied_at) VALUES (?, ?)')
      .run(trackerTrustVersion, nowIso());
  }

  const aiArtifactsVersion = '0003_ai_artifacts';
  const aiArtifactsApplied = sqlite
    .prepare('SELECT version FROM __career_rafiq_migrations WHERE version = ? LIMIT 1')
    .get(aiArtifactsVersion) as { version: string } | undefined;
  if (!aiArtifactsApplied) {
    createAiArtifactsTable(sqlite);
    sqlite
      .prepare('INSERT INTO __career_rafiq_migrations (version, applied_at) VALUES (?, ?)')
      .run(aiArtifactsVersion, nowIso());
  }

  const eyeDiagnosticsVersion = '0004_eye_diagnostics';
  const eyeDiagnosticsApplied = sqlite
    .prepare('SELECT version FROM __career_rafiq_migrations WHERE version = ? LIMIT 1')
    .get(eyeDiagnosticsVersion) as { version: string } | undefined;
  if (!eyeDiagnosticsApplied) {
    createEyeDiagnosticsTables(sqlite);
    sqlite
      .prepare('INSERT INTO __career_rafiq_migrations (version, applied_at) VALUES (?, ?)')
      .run(eyeDiagnosticsVersion, nowIso());
  }

  const cvVersionsVersion = '0005_cv_versions';
  const cvVersionsApplied = sqlite
    .prepare('SELECT version FROM __career_rafiq_migrations WHERE version = ? LIMIT 1')
    .get(cvVersionsVersion) as { version: string } | undefined;
  if (!cvVersionsApplied) {
    createCvVersionsTable(sqlite);
    sqlite
      .prepare('INSERT INTO __career_rafiq_migrations (version, applied_at) VALUES (?, ?)')
      .run(cvVersionsVersion, nowIso());
  }
}

export function migrateDatabaseFile(filePath: string): void {
  const sqlite = new Database(ensureDatabaseDirectory(filePath));
  try {
    runMigrations(sqlite);
  } finally {
    sqlite.close();
  }
}

if (process.env['CAREERRAFIQ_RUN_DB_MIGRATIONS'] === '1') {
  migrateDatabaseFile(process.env['CAREERRAFIQ_DB_FILE'] ?? resolve(process.cwd(), 'apps', 'api', 'data', 'career-rafiq.db'));
}
