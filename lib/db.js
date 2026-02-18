import { createClient } from '@libsql/client';

let client;

export function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS characters (
    name TEXT PRIMARY KEY,
    rsn TEXT NOT NULL,
    stats TEXT DEFAULT '{}',
    gear TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'planned',
    assigned_to TEXT,
    requirements TEXT DEFAULT '',
    plan TEXT DEFAULT '',
    rewards TEXT DEFAULT '',
    priority INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    assigned_to TEXT,
    status TEXT DEFAULT 'active',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS guides (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_cache (
    page_title TEXT PRIMARY KEY,
    sections TEXT NOT NULL,
    fetched_at TEXT DEFAULT (datetime('now'))
);
`;

let migrated = false;

export async function ensureSchema() {
  if (migrated) return;
  const db = getClient();
  const statements = SCHEMA.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    await db.execute(stmt);
  }
  migrated = true;
}

// Query helpers

export async function getCharacter(name) {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT * FROM characters WHERE name = ?',
    args: [name],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { ...row, stats: JSON.parse(row.stats || '{}') };
}

export async function upsertCharacter(name, data) {
  await ensureSchema();
  const db = getClient();
  const existing = await getCharacter(name);
  if (existing) {
    const sets = [];
    const args = [];
    if (data.rsn !== undefined) { sets.push('rsn = ?'); args.push(data.rsn); }
    if (data.stats !== undefined) { sets.push('stats = ?'); args.push(JSON.stringify(data.stats)); }
    if (data.gear !== undefined) { sets.push('gear = ?'); args.push(data.gear); }
    if (data.notes !== undefined) { sets.push('notes = ?'); args.push(data.notes); }
    sets.push("updated_at = datetime('now')");
    args.push(name);
    await db.execute({ sql: `UPDATE characters SET ${sets.join(', ')} WHERE name = ?`, args });
  } else {
    await db.execute({
      sql: 'INSERT INTO characters (name, rsn, stats, gear, notes) VALUES (?, ?, ?, ?, ?)',
      args: [name, data.rsn || '', JSON.stringify(data.stats || {}), data.gear || '', data.notes || ''],
    });
  }
  return getCharacter(name);
}

export async function listQuests(filters = {}) {
  await ensureSchema();
  const db = getClient();
  let sql = 'SELECT * FROM quests';
  const conditions = [];
  const args = [];
  if (filters.status) { conditions.push('status = ?'); args.push(filters.status); }
  if (filters.assigned_to) { conditions.push('assigned_to = ?'); args.push(filters.assigned_to); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY priority DESC, id ASC';
  const result = await db.execute({ sql, args });
  return result.rows;
}

export async function getQuest(name) {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT * FROM quests WHERE name = ?',
    args: [name],
  });
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function upsertQuest(name, data) {
  await ensureSchema();
  const db = getClient();
  const existing = await getQuest(name);
  if (existing) {
    const sets = [];
    const args = [];
    if (data.status !== undefined) { sets.push('status = ?'); args.push(data.status); }
    if (data.assigned_to !== undefined) { sets.push('assigned_to = ?'); args.push(data.assigned_to); }
    if (data.requirements !== undefined) { sets.push('requirements = ?'); args.push(data.requirements); }
    if (data.plan !== undefined) { sets.push('plan = ?'); args.push(data.plan); }
    if (data.rewards !== undefined) { sets.push('rewards = ?'); args.push(data.rewards); }
    if (data.priority !== undefined) { sets.push('priority = ?'); args.push(data.priority); }
    sets.push("updated_at = datetime('now')");
    args.push(name);
    await db.execute({ sql: `UPDATE quests SET ${sets.join(', ')} WHERE name = ?`, args });
  } else {
    await db.execute({
      sql: 'INSERT INTO quests (name, status, assigned_to, requirements, plan, rewards, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [
        name,
        data.status || 'planned',
        data.assigned_to || null,
        data.requirements || '',
        data.plan || '',
        data.rewards || '',
        data.priority || 0,
      ],
    });
  }
  return getQuest(name);
}

export async function listGoals(status) {
  await ensureSchema();
  const db = getClient();
  let sql = 'SELECT * FROM goals';
  const args = [];
  if (status) { sql += ' WHERE status = ?'; args.push(status); }
  sql += ' ORDER BY id ASC';
  const result = await db.execute({ sql, args });
  return result.rows;
}

export async function addGoal(description, assigned_to, notes) {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: 'INSERT INTO goals (description, assigned_to, notes) VALUES (?, ?, ?)',
    args: [description, assigned_to || null, notes || ''],
  });
  return { id: Number(result.lastInsertRowid), description, assigned_to, status: 'active', notes };
}

export async function completeGoal(id) {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: "UPDATE goals SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
    args: [id],
  });
  const result = await db.execute({ sql: 'SELECT * FROM goals WHERE id = ?', args: [id] });
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function getGuide(slug) {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT * FROM guides WHERE slug = ?',
    args: [slug],
  });
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function upsertGuide(slug, title, content) {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO guides (slug, title, content) VALUES (?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET title = ?, content = ?, updated_at = datetime('now')`,
    args: [slug, title, content, title, content],
  });
  return getGuide(slug);
}

// ── Wiki Cache ──

export async function getCachedPage(pageTitle) {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT * FROM wiki_cache WHERE page_title = ?',
    args: [pageTitle],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { ...row, sections: JSON.parse(row.sections) };
}

export async function cachePage(pageTitle, sections) {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO wiki_cache (page_title, sections) VALUES (?, ?)
          ON CONFLICT(page_title) DO UPDATE SET sections = ?, fetched_at = datetime('now')`,
    args: [pageTitle, JSON.stringify(sections), JSON.stringify(sections)],
  });
  return getCachedPage(pageTitle);
}

export async function listCachedPages() {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute('SELECT page_title, fetched_at FROM wiki_cache ORDER BY fetched_at DESC');
  return result.rows;
}

export async function searchAll(query) {
  await ensureSchema();
  const db = getClient();
  const term = `%${query}%`;
  const results = { characters: [], quests: [], goals: [], guides: [] };

  const chars = await db.execute({
    sql: 'SELECT * FROM characters WHERE name LIKE ? OR rsn LIKE ? OR notes LIKE ? OR gear LIKE ?',
    args: [term, term, term, term],
  });
  results.characters = chars.rows;

  const quests = await db.execute({
    sql: 'SELECT * FROM quests WHERE name LIKE ? OR requirements LIKE ? OR plan LIKE ? OR rewards LIKE ?',
    args: [term, term, term, term],
  });
  results.quests = quests.rows;

  const goals = await db.execute({
    sql: 'SELECT * FROM goals WHERE description LIKE ? OR notes LIKE ?',
    args: [term, term],
  });
  results.goals = goals.rows;

  const guides = await db.execute({
    sql: 'SELECT * FROM guides WHERE slug LIKE ? OR title LIKE ? OR content LIKE ?',
    args: [term, term, term],
  });
  results.guides = guides.rows;

  return results;
}
