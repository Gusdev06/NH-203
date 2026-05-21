import Database from 'better-sqlite3';

const dryRun = process.argv.includes('--apply') ? false : true;
const db = new Database('hot.db');

type Row = {
  telegram_id: number;
  paid_credits: number;
  spent_credits: number;
  current_credits: number | null;
  user_exists: number;
};

const rows = db
  .prepare(
    `SELECT
       o.telegram_id AS telegram_id,
       COALESCE(SUM(o.credits), 0) AS paid_credits,
       COALESCE((SELECT SUM(g.credits_spent) FROM generations g WHERE g.telegram_id = o.telegram_id), 0) AS spent_credits,
       (SELECT u.credits FROM users u WHERE u.telegram_id = o.telegram_id) AS current_credits,
       (SELECT COUNT(*) FROM users u WHERE u.telegram_id = o.telegram_id) AS user_exists
     FROM processed_orders o
     WHERE o.telegram_id IS NOT NULL AND o.credits > 0
     GROUP BY o.telegram_id`
  )
  .all() as Row[];

let totalMissing = 0;
let affectedUsers = 0;

const insertUser = db.prepare(
  'INSERT OR IGNORE INTO users (telegram_id, credits, created_at) VALUES (?, 0, ?)'
);
const grantCredits = db.prepare(
  'UPDATE users SET credits = credits + ? WHERE telegram_id = ?'
);

const apply = db.transaction((r: Row, diff: number) => {
  insertUser.run(r.telegram_id, Date.now());
  grantCredits.run(diff, r.telegram_id);
});

for (const r of rows) {
  const current = r.current_credits ?? 0;
  const expected = r.paid_credits - r.spent_credits;
  const diff = expected - current;
  if (diff <= 0) continue;
  affectedUsers++;
  totalMissing += diff;
  console.log(
    `user=${r.telegram_id}  paid=${r.paid_credits}  spent=${r.spent_credits}  ` +
      `current=${current}  expected=${expected}  → grant +${diff}` +
      (r.user_exists ? '' : '  (criando user row)')
  );
  if (!dryRun) apply(r, diff);
}

console.log('---');
console.log(`usuários afetados: ${affectedUsers}`);
console.log(`créditos faltando: ${totalMissing}`);
console.log(dryRun ? 'DRY RUN (use --apply para gravar)' : 'APLICADO');
