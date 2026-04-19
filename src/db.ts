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

const usersCols = db
  .prepare("PRAGMA table_info(users)")
  .all() as { name: string }[];
const hasUserCol = (name: string) => usersCols.some((c) => c.name === name);
if (!hasUserCol('banned')) {
  db.exec('ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0');
}
if (!hasUserCol('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
if (!hasUserCol('first_name')) db.exec('ALTER TABLE users ADD COLUMN first_name TEXT');
if (!hasUserCol('last_name')) db.exec('ALTER TABLE users ADD COLUMN last_name TEXT');
if (!hasUserCol('is_premium'))
  db.exec('ALTER TABLE users ADD COLUMN is_premium INTEGER NOT NULL DEFAULT 0');
if (!hasUserCol('language_code'))
  db.exec('ALTER TABLE users ADD COLUMN language_code TEXT');
if (!hasUserCol('last_active')) db.exec('ALTER TABLE users ADD COLUMN last_active INTEGER');
if (!hasUserCol('note')) db.exec('ALTER TABLE users ADD COLUMN note TEXT');

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

export function updateUserProfile(
  telegramId: number,
  profile: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    isPremium: boolean;
    languageCode: string | null;
  }
): void {
  db.prepare(
    `UPDATE users SET
       username = ?, first_name = ?, last_name = ?,
       is_premium = ?, language_code = ?, last_active = ?
     WHERE telegram_id = ?`
  ).run(
    profile.username,
    profile.firstName,
    profile.lastName,
    profile.isPremium ? 1 : 0,
    profile.languageCode,
    Date.now(),
    telegramId
  );
}

export function setUserNote(telegramId: number, note: string | null): boolean {
  const result = db
    .prepare('UPDATE users SET note = ? WHERE telegram_id = ?')
    .run(note, telegramId);
  return result.changes === 1;
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

export type AdminUser = {
  telegram_id: number;
  credits: number;
  created_at: number;
  banned: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_premium: number;
  language_code: string | null;
  last_active: number | null;
  note: string | null;
};
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

export type PackageSale = {
  pkg_id: string;
  count: number;
  revenue: number;
  credits: number;
};

export type TopSpender = AdminUser & {
  total_spent: number;
  orders_count: number;
};

export type AdminStats = {
  totals: {
    users: number;
    activeUsers7d: number;
    bannedUsers: number;
    premiumUsers: number;
    creditsOutstanding: number;
    generationsOk: number;
    generationsFailed: number;
    generationsToday: number;
    revenueBrl: number;
    revenueToday: number;
    ordersCount: number;
    unmatchedOrders: number;
    payingUsers: number;
  };
  recentUsers: AdminUser[];
  recentGenerations: AdminGeneration[];
  recentOrders: AdminOrder[];
  topSpenders: TopSpender[];
  unmatchedOrders: AdminOrder[];
  packageSales: PackageSale[];
  dailyGenerations: { day: string; count: number }[];
  dailyRevenue: { day: string; revenue: number }[];
};

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const USER_COLS =
  'telegram_id, credits, created_at, banned, username, first_name, last_name, is_premium, language_code, last_active, note';

export function getAdminStats(): AdminStats {
  const scalar = <T>(sql: string, ...args: unknown[]): T =>
    (db.prepare(sql).get(...args) as { v: T }).v;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const startToday = startOfTodayMs();

  const totals = {
    users: scalar<number>('SELECT COUNT(*) AS v FROM users'),
    activeUsers7d: scalar<number>(
      'SELECT COUNT(*) AS v FROM users WHERE last_active >= ?',
      sevenDaysAgo
    ),
    bannedUsers: scalar<number>('SELECT COUNT(*) AS v FROM users WHERE banned = 1'),
    premiumUsers: scalar<number>(
      'SELECT COUNT(*) AS v FROM users WHERE is_premium = 1'
    ),
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
      startToday
    ),
    revenueBrl: scalar<number>(
      'SELECT COALESCE(SUM(amount), 0) AS v FROM processed_orders'
    ),
    revenueToday: scalar<number>(
      'SELECT COALESCE(SUM(amount), 0) AS v FROM processed_orders WHERE created_at >= ?',
      startToday
    ),
    ordersCount: scalar<number>('SELECT COUNT(*) AS v FROM processed_orders'),
    unmatchedOrders: scalar<number>(
      'SELECT COUNT(*) AS v FROM processed_orders WHERE telegram_id IS NULL'
    ),
    payingUsers: scalar<number>(
      'SELECT COUNT(DISTINCT telegram_id) AS v FROM processed_orders WHERE telegram_id IS NOT NULL'
    ),
  };

  const recentUsers = db
    .prepare(
      `SELECT ${USER_COLS} FROM users ORDER BY created_at DESC LIMIT 20`
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

  const topSpenders = db
    .prepare(
      `SELECT u.${USER_COLS.split(', ').join(', u.')},
              COALESCE(SUM(o.amount), 0) AS total_spent,
              COUNT(o.order_id) AS orders_count
       FROM users u
       JOIN processed_orders o ON o.telegram_id = u.telegram_id
       GROUP BY u.telegram_id
       ORDER BY total_spent DESC
       LIMIT 10`
    )
    .all() as TopSpender[];

  const unmatchedOrders = db
    .prepare(
      'SELECT order_id, telegram_id, pkg_id, credits, amount, created_at FROM processed_orders WHERE telegram_id IS NULL ORDER BY created_at DESC LIMIT 20'
    )
    .all() as AdminOrder[];

  const packageSales = db
    .prepare(
      `SELECT pkg_id, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS revenue,
              COALESCE(SUM(credits), 0) AS credits
       FROM processed_orders
       WHERE pkg_id IS NOT NULL
       GROUP BY pkg_id
       ORDER BY revenue DESC`
    )
    .all() as PackageSale[];

  const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const dailyGenerations = db
    .prepare(
      `SELECT date(created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
       FROM generations
       WHERE credits_spent > 0 AND created_at >= ?
       GROUP BY day ORDER BY day ASC`
    )
    .all(since) as { day: string; count: number }[];

  const dailyRevenue = db
    .prepare(
      `SELECT date(created_at/1000, 'unixepoch', 'localtime') AS day,
              COALESCE(SUM(amount), 0) AS revenue
       FROM processed_orders
       WHERE created_at >= ?
       GROUP BY day ORDER BY day ASC`
    )
    .all(since) as { day: string; revenue: number }[];

  return {
    totals,
    recentUsers,
    recentGenerations,
    recentOrders,
    topSpenders,
    unmatchedOrders,
    packageSales,
    dailyGenerations,
    dailyRevenue,
  };
}

export function isBanned(telegramId: number): boolean {
  const row = db
    .prepare('SELECT banned FROM users WHERE telegram_id = ?')
    .get(telegramId) as { banned: number } | undefined;
  return row?.banned === 1;
}

export function setBanned(telegramId: number, banned: boolean): boolean {
  const result = db
    .prepare('UPDATE users SET banned = ? WHERE telegram_id = ?')
    .run(banned ? 1 : 0, telegramId);
  return result.changes === 1;
}

export type AdminCreditsResult =
  | { ok: true; credits: number }
  | { ok: false; reason: string };

export function adminAddCredits(
  telegramId: number,
  amount: number
): AdminCreditsResult {
  if (!Number.isInteger(amount) || amount === 0) {
    return { ok: false, reason: 'quantidade inválida' };
  }
  const txn = db.transaction((): AdminCreditsResult => {
    const row = db
      .prepare('SELECT credits FROM users WHERE telegram_id = ?')
      .get(telegramId) as { credits: number } | undefined;
    if (!row) return { ok: false, reason: 'usuário não encontrado' };
    const next = row.credits + amount;
    if (next < 0) return { ok: false, reason: 'saldo não pode ficar negativo' };
    db.prepare('UPDATE users SET credits = ? WHERE telegram_id = ?').run(
      next,
      telegramId
    );
    return { ok: true, credits: next };
  });
  return txn();
}

export type UserDetail = {
  user: AdminUser;
  generations: AdminGeneration[];
  orders: AdminOrder[];
  totals: { spent: number; generations: number; revenue: number };
};

export function getUserDetail(telegramId: number): UserDetail | null {
  const user = db
    .prepare(`SELECT ${USER_COLS} FROM users WHERE telegram_id = ?`)
    .get(telegramId) as AdminUser | undefined;
  if (!user) return null;

  const generations = db
    .prepare(
      'SELECT id, telegram_id, prompt, credits_spent, created_at FROM generations WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 100'
    )
    .all(telegramId) as AdminGeneration[];

  const orders = db
    .prepare(
      'SELECT order_id, telegram_id, pkg_id, credits, amount, created_at FROM processed_orders WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 100'
    )
    .all(telegramId) as AdminOrder[];

  const spent = (db
    .prepare(
      'SELECT COALESCE(SUM(credits_spent), 0) AS v FROM generations WHERE telegram_id = ?'
    )
    .get(telegramId) as { v: number }).v;
  const generationsOk = (db
    .prepare(
      'SELECT COUNT(*) AS v FROM generations WHERE telegram_id = ? AND credits_spent > 0'
    )
    .get(telegramId) as { v: number }).v;
  const revenue = (db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS v FROM processed_orders WHERE telegram_id = ?'
    )
    .get(telegramId) as { v: number }).v;

  return {
    user,
    generations,
    orders,
    totals: { spent, generations: generationsOk, revenue },
  };
}

export function searchUsers(query: string): AdminUser[] {
  const q = query.trim();
  if (!q) {
    return db
      .prepare(
        `SELECT ${USER_COLS} FROM users ORDER BY created_at DESC LIMIT 200`
      )
      .all() as AdminUser[];
  }
  const asNumber = Number(q.replace(/[^\d-]/g, ''));
  const cleanUsername = q.replace(/^@+/, '');
  const likeQ = `%${cleanUsername}%`;
  return db
    .prepare(
      `SELECT ${USER_COLS} FROM users
       WHERE telegram_id = ?
          OR username LIKE ? COLLATE NOCASE
          OR first_name LIKE ? COLLATE NOCASE
          OR last_name LIKE ? COLLATE NOCASE
          OR note LIKE ? COLLATE NOCASE
       ORDER BY last_active DESC NULLS LAST, created_at DESC
       LIMIT 200`
    )
    .all(asNumber || 0, likeQ, likeQ, likeQ, likeQ) as AdminUser[];
}

export function resolveUserTarget(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  const cleanUsername = s.replace(/^@+/, '');
  const row = db
    .prepare(
      'SELECT telegram_id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1'
    )
    .get(cleanUsername) as { telegram_id: number } | undefined;
  return row?.telegram_id ?? null;
}

export function getAllOrdersForCsv(): AdminOrder[] {
  return db
    .prepare(
      'SELECT order_id, telegram_id, pkg_id, credits, amount, created_at FROM processed_orders ORDER BY created_at DESC'
    )
    .all() as AdminOrder[];
}

export function getAllGenerationsForCsv(): AdminGeneration[] {
  return db
    .prepare(
      'SELECT id, telegram_id, prompt, credits_spent, created_at FROM generations ORDER BY created_at DESC'
    )
    .all() as AdminGeneration[];
}
