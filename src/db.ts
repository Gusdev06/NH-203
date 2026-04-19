import Database from 'better-sqlite3';

const db = new Database('hot.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    credits INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    credits_spent INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processed_orders (
    order_id TEXT PRIMARY KEY,
    telegram_id INTEGER,
    pkg_id TEXT,
    credits INTEGER NOT NULL,
    amount REAL NOT NULL,
    raw_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const generationsCols = db
  .prepare("PRAGMA table_info(generations)")
  .all() as { name: string }[];
if (generationsCols.some((c) => c.name === 'image_url')) {
  db.exec('ALTER TABLE generations DROP COLUMN image_url');
}

const INITIAL_CREDITS = 5;

export function ensureUser(telegramId: number): { credits: number; isNew: boolean } {
  const existing = db
    .prepare('SELECT credits FROM users WHERE telegram_id = ?')
    .get(telegramId) as { credits: number } | undefined;
  if (existing) return { credits: existing.credits, isNew: false };
  db.prepare(
    'INSERT INTO users (telegram_id, credits, created_at) VALUES (?, ?, ?)'
  ).run(telegramId, INITIAL_CREDITS, Date.now());
  return { credits: INITIAL_CREDITS, isNew: true };
}

export function getCredits(telegramId: number): number {
  const row = db
    .prepare('SELECT credits FROM users WHERE telegram_id = ?')
    .get(telegramId) as { credits: number } | undefined;
  return row?.credits ?? 0;
}

export function debitCredits(telegramId: number, amount: number): boolean {
  const result = db
    .prepare(
      'UPDATE users SET credits = credits - ? WHERE telegram_id = ? AND credits >= ?'
    )
    .run(amount, telegramId, amount);
  return result.changes === 1;
}

export function refundCredits(telegramId: number, amount: number): void {
  db.prepare('UPDATE users SET credits = credits + ? WHERE telegram_id = ?').run(
    amount,
    telegramId
  );
}

export function addCredits(telegramId: number, amount: number): void {
  db.prepare('UPDATE users SET credits = credits + ? WHERE telegram_id = ?').run(
    amount,
    telegramId
  );
}

export type ProcessOrderResult =
  | { status: 'credited'; credits: number }
  | { status: 'duplicate' };

export function processOrder(params: {
  orderId: string;
  telegramId: number | null;
  pkgId: string | null;
  credits: number;
  amount: number;
  rawPayload: string;
}): ProcessOrderResult {
  const txn = db.transaction(() => {
    const existing = db
      .prepare('SELECT 1 FROM processed_orders WHERE order_id = ?')
      .get(params.orderId);
    if (existing) return { status: 'duplicate' as const };

    db.prepare(
      `INSERT INTO processed_orders
       (order_id, telegram_id, pkg_id, credits, amount, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.orderId,
      params.telegramId,
      params.pkgId,
      params.credits,
      params.amount,
      params.rawPayload,
      Date.now()
    );
    if (params.telegramId && params.credits > 0) {
      db.prepare(
        'UPDATE users SET credits = credits + ? WHERE telegram_id = ?'
      ).run(params.credits, params.telegramId);
    }
    return { status: 'credited' as const, credits: params.credits };
  });
  return txn();
}

export function logGeneration(
  telegramId: number,
  prompt: string,
  creditsSpent: number
): void {
  db.prepare(
    'INSERT INTO generations (telegram_id, prompt, credits_spent, created_at) VALUES (?, ?, ?, ?)'
  ).run(telegramId, prompt, creditsSpent, Date.now());
}
