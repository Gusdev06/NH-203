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

export type AdminUser = { telegram_id: number; credits: number; created_at: number };
export type AdminGeneration = {
  id: number;
  telegram_id: number;
  prompt: string;
  credits_spent: number;
  created_at: number;
};
export type AdminOrder = {
  order_id: string;
  telegram_id: number | null;
  pkg_id: string | null;
  credits: number;
  amount: number;
  created_at: number;
};

export type AdminStats = {
  totals: {
    users: number;
    creditsOutstanding: number;
    generationsOk: number;
    generationsFailed: number;
    generationsToday: number;
    revenueBrl: number;
    ordersCount: number;
  };
  recentUsers: AdminUser[];
  recentGenerations: AdminGeneration[];
  recentOrders: AdminOrder[];
  dailyGenerations: { day: string; count: number }[];
};

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function getAdminStats(): AdminStats {
  const scalar = <T>(sql: string, ...args: unknown[]): T =>
    (db.prepare(sql).get(...args) as { v: T }).v;

  const totals = {
    users: scalar<number>('SELECT COUNT(*) AS v FROM users'),
    creditsOutstanding: scalar<number>(
      'SELECT COALESCE(SUM(credits), 0) AS v FROM users'
    ),
    generationsOk: scalar<number>(
      'SELECT COUNT(*) AS v FROM generations WHERE credits_spent > 0'
    ),
    generationsFailed: scalar<number>(
      'SELECT COUNT(*) AS v FROM generations WHERE credits_spent = 0'
    ),
    generationsToday: scalar<number>(
      'SELECT COUNT(*) AS v FROM generations WHERE credits_spent > 0 AND created_at >= ?',
      startOfTodayMs()
    ),
    revenueBrl: scalar<number>(
      'SELECT COALESCE(SUM(amount), 0) AS v FROM processed_orders'
    ),
    ordersCount: scalar<number>('SELECT COUNT(*) AS v FROM processed_orders'),
  };

  const recentUsers = db
    .prepare(
      'SELECT telegram_id, credits, created_at FROM users ORDER BY created_at DESC LIMIT 20'
    )
    .all() as AdminUser[];

  const recentGenerations = db
    .prepare(
      'SELECT id, telegram_id, prompt, credits_spent, created_at FROM generations ORDER BY created_at DESC LIMIT 20'
    )
    .all() as AdminGeneration[];

  const recentOrders = db
    .prepare(
      'SELECT order_id, telegram_id, pkg_id, credits, amount, created_at FROM processed_orders ORDER BY created_at DESC LIMIT 20'
    )
    .all() as AdminOrder[];

  const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const dailyGenerations = db
    .prepare(
      `SELECT date(created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
       FROM generations
       WHERE credits_spent > 0 AND created_at >= ?
       GROUP BY day ORDER BY day ASC`
    )
    .all(since) as { day: string; count: number }[];

  return {
    totals,
    recentUsers,
    recentGenerations,
    recentOrders,
    dailyGenerations,
  };
}
