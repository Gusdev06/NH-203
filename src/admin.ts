import type {
  AdminStats,
  AdminGeneration,
  AdminOrder,
  UserDetail,
} from './db.ts';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtBrl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR');
}

function renderChart(
  daily: { day: string; count: number }[]
): { bars: string; labels: string } {
  const days: { day: string; count: number }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const byDay = new Map(daily.map((d) => [d.day, d.count]));
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.count));
  const bars = days
    .map((d) => {
      const h = Math.round((d.count / max) * 100);
      const date = new Date(d.day + 'T00:00:00');
      const label = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
      return `<div class="bar" style="height:${h}%"><span class="tip">${label}: ${d.count}</span></div>`;
    })
    .join('');
  const labels = days
    .map((d, i) => {
      if (i % 2 !== 0) return '<div></div>';
      const date = new Date(d.day + 'T00:00:00');
      const label = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
      return `<div>${label}</div>`;
    })
    .join('');
  return { bars, labels };
}

const SHARED_STYLES = `
  :root{
    --bg:#0b0b0e;--card:#15151a;--border:#26262e;--fg:#e5e5ea;--muted:#7a7a85;
    --accent:#ff6b35;--ok:#3ecf8e;--warn:#eab308;--danger:#ef4444;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:1200px;margin:0 auto;padding:24px}
  .topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:13px}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:6px;background:#1c1c23;border:1px solid var(--border);
    color:var(--fg);padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;text-decoration:none;transition:background .15s}
  .btn:hover{background:#23232c;text-decoration:none}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .btn.primary:hover{background:#e85a2a}
  .btn.danger{background:var(--danger);border-color:var(--danger);color:#fff}
  .btn.danger:hover{background:#d63838}
  .btn.sm{padding:5px 10px;font-size:12px}
  .flash{padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:13px}
  .flash.ok{background:rgba(62,207,142,.12);border:1px solid rgba(62,207,142,.3);color:var(--ok)}
  .flash.err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:var(--danger)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px}
  .card .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
  .card .val{font-size:24px;font-weight:600;line-height:1}
  .card .hint{color:var(--muted);font-size:11px;margin-top:6px}
  .card.accent .val{color:var(--accent)}
  .card.ok .val{color:var(--ok)}
  .card.warn .val{color:var(--warn)}
  .card.danger .val{color:var(--danger)}
  section{background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:16px;overflow:hidden}
  section h2{font-size:12px;margin:0;padding:12px 16px;border-bottom:1px solid var(--border);
    color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:500;display:flex;justify-content:space-between;align-items:center}
  .form{padding:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
  .field{display:flex;flex-direction:column;gap:4px;min-width:140px}
  .field label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .field input{background:#0b0b0e;border:1px solid var(--border);color:var(--fg);padding:8px 10px;
    border-radius:6px;font-size:13px;font-family:inherit}
  .field input:focus{outline:none;border-color:var(--accent)}
  .tablewrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:10px 16px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
  th{color:var(--muted);font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.06em;background:#111117}
  tr:last-child td{border-bottom:none}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .chart{display:flex;align-items:flex-end;gap:6px;padding:16px 16px 8px;height:140px}
  .bar{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;position:relative;opacity:.78;transition:opacity .15s}
  .bar:hover{opacity:1}
  .bar .tip{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#000;color:#fff;
    padding:4px 8px;font-size:11px;border-radius:4px;white-space:nowrap;pointer-events:none;opacity:0;margin-bottom:6px;transition:opacity .15s}
  .bar:hover .tip{opacity:1}
  .daylabels{display:flex;gap:6px;padding:0 16px 14px;font-size:10px;color:var(--muted)}
  .daylabels div{flex:1;text-align:center}
  .empty{padding:20px 16px;color:var(--muted);font-size:13px;text-align:center}
  .prompt{max-width:380px;overflow:hidden;text-overflow:ellipsis;color:#aaa;white-space:nowrap}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:500;
    text-transform:uppercase;letter-spacing:.05em}
  .badge.banned{background:rgba(239,68,68,.15);color:var(--danger)}
  .foot{text-align:center;color:var(--muted);font-size:11px;margin-top:24px}
`;

type FlashMessages = { ok?: string; err?: string };

function renderFlash(flash: FlashMessages): string {
  let out = '';
  if (flash.ok) out += `<div class="flash ok">✅ ${esc(flash.ok)}</div>`;
  if (flash.err) out += `<div class="flash err">⚠️ ${esc(flash.err)}</div>`;
  return out;
}

function baseHref(basePath: string): string {
  return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
}

export function renderAdminDashboard(
  stats: AdminStats,
  basePath: string,
  flash: FlashMessages = {}
): string {
  const { totals, recentUsers, recentGenerations, recentOrders } = stats;
  const chart = renderChart(stats.dailyGenerations);
  const now = fmtDate(Date.now());
  const base = baseHref(basePath);

  const usersRows = recentUsers.length
    ? recentUsers
        .map(
          (u) => `
        <tr>
          <td class="mono"><a href="${base}/user/${u.telegram_id}">${u.telegram_id}</a>${u.banned ? ' <span class="badge banned">BAN</span>' : ''}</td>
          <td class="num">${fmtInt(u.credits)}</td>
          <td>${esc(fmtDate(u.created_at))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" class="empty">Nenhum usuário ainda</td></tr>`;

  const gensRows = recentGenerations.length
    ? recentGenerations
        .map((g) => {
          const ok = g.credits_spent > 0;
          return `
        <tr>
          <td>${ok ? '✅' : '❌'}</td>
          <td class="mono"><a href="${base}/user/${g.telegram_id}">${g.telegram_id}</a></td>
          <td class="prompt" title="${esc(g.prompt)}">${esc(g.prompt)}</td>
          <td class="num">${g.credits_spent}</td>
          <td>${esc(fmtDate(g.created_at))}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="empty">Nenhuma geração ainda</td></tr>`;

  const ordersRows = recentOrders.length
    ? recentOrders
        .map(
          (o) => `
        <tr>
          <td class="mono" title="${esc(o.order_id)}">${esc(o.order_id.slice(0, 10))}…</td>
          <td class="mono">${o.telegram_id ? `<a href="${base}/user/${o.telegram_id}">${o.telegram_id}</a>` : '—'}</td>
          <td>${esc(o.pkg_id ?? '—')}</td>
          <td class="num">${fmtInt(o.credits)}</td>
          <td class="num">${esc(fmtBrl(o.amount))}</td>
          <td>${esc(fmtDate(o.created_at))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="empty">Nenhum pedido ainda</td></tr>`;

  const autoRefresh = flash.ok || flash.err ? '' : '<meta http-equiv="refresh" content="30">';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${autoRefresh}
<title>HOT — Admin</title>
<style>${SHARED_STYLES}</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div>
      <h1>🔥 HOT — Admin</h1>
      <div class="sub">Atualizado ${esc(now)}${autoRefresh ? ' • recarrega a cada 30s' : ''}</div>
    </div>
    <div class="actions">
      <a class="btn sm" href="${base}/export/orders.csv">⬇️ Pedidos CSV</a>
      <a class="btn sm" href="${base}/export/generations.csv">⬇️ Gerações CSV</a>
      <a class="btn sm" href="${base}/">🔄 Atualizar</a>
    </div>
  </div>

  ${renderFlash(flash)}

  <div class="cards">
    <div class="card"><div class="label">Usuários</div><div class="val">${fmtInt(totals.users)}</div></div>
    <div class="card warn"><div class="label">Créditos em circulação</div><div class="val">${fmtInt(totals.creditsOutstanding)}</div><div class="hint">≈ ${fmtInt(Math.floor(totals.creditsOutstanding / 5))} imagens pagas</div></div>
    <div class="card ok"><div class="label">Receita total</div><div class="val">${esc(fmtBrl(totals.revenueBrl))}</div><div class="hint">${fmtInt(totals.ordersCount)} pedidos</div></div>
    <div class="card accent"><div class="label">Gerações hoje</div><div class="val">${fmtInt(totals.generationsToday)}</div></div>
    <div class="card"><div class="label">Gerações totais</div><div class="val">${fmtInt(totals.generationsOk)}</div><div class="hint">${fmtInt(totals.generationsFailed)} falhas</div></div>
  </div>

  <section>
    <h2>Ações rápidas</h2>
    <form class="form" method="post" action="${base}/credits">
      <input type="hidden" name="return" value="/">
      <div class="field">
        <label>Telegram ID</label>
        <input name="telegram_id" type="number" required placeholder="123456789">
      </div>
      <div class="field">
        <label>Créditos (+/-)</label>
        <input name="amount" type="number" required placeholder="50 ou -10">
      </div>
      <button class="btn primary" type="submit">Aplicar</button>
    </form>
  </section>

  <section>
    <h2>Gerações — últimos 14 dias</h2>
    <div class="chart">${chart.bars}</div>
    <div class="daylabels">${chart.labels}</div>
  </section>

  <section>
    <h2>Pedidos recentes</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Order ID</th><th>Telegram ID</th><th>Pacote</th><th class="num">Créditos</th><th class="num">Valor</th><th>Quando</th></tr></thead>
        <tbody>${ordersRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Gerações recentes</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th></th><th>Telegram ID</th><th>Prompt</th><th class="num">Créditos</th><th>Quando</th></tr></thead>
        <tbody>${gensRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Usuários recentes</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Telegram ID</th><th class="num">Créditos</th><th>Entrou</th></tr></thead>
        <tbody>${usersRows}</tbody>
      </table>
    </div>
  </section>

  <div class="foot">HOT Admin • SQLite live view</div>
</div>
</body>
</html>`;
}

export function renderUserDetail(
  detail: UserDetail,
  basePath: string,
  flash: FlashMessages = {}
): string {
  const base = baseHref(basePath);
  const { user, generations, orders, totals } = detail;
  const backReturn = `/user/${user.telegram_id}`;

  const gensRows = generations.length
    ? generations
        .map((g: AdminGeneration) => {
          const ok = g.credits_spent > 0;
          return `
        <tr>
          <td>${ok ? '✅' : '❌'}</td>
          <td class="prompt" title="${esc(g.prompt)}">${esc(g.prompt)}</td>
          <td class="num">${g.credits_spent}</td>
          <td>${esc(fmtDate(g.created_at))}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="4" class="empty">Nenhuma geração</td></tr>`;

  const ordersRows = orders.length
    ? orders
        .map(
          (o: AdminOrder) => `
        <tr>
          <td class="mono" title="${esc(o.order_id)}">${esc(o.order_id.slice(0, 12))}…</td>
          <td>${esc(o.pkg_id ?? '—')}</td>
          <td class="num">${fmtInt(o.credits)}</td>
          <td class="num">${esc(fmtBrl(o.amount))}</td>
          <td>${esc(fmtDate(o.created_at))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="empty">Nenhum pedido</td></tr>`;

  const banButtonLabel = user.banned ? '🔓 Desbanir' : '🔒 Banir';
  const banButtonClass = user.banned ? 'btn' : 'btn danger';
  const banConfirm = user.banned
    ? 'Desbanir esse usuário?'
    : 'Banir esse usuário? Ele não conseguirá mais usar o bot.';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Usuário ${user.telegram_id} — HOT Admin</title>
<style>${SHARED_STYLES}</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div>
      <h1 class="mono">Usuário ${user.telegram_id} ${user.banned ? '<span class="badge banned">BANIDO</span>' : ''}</h1>
      <div class="sub">Entrou em ${esc(fmtDate(user.created_at))}</div>
    </div>
    <div class="actions">
      <a class="btn sm" href="${base}/">← Voltar</a>
    </div>
  </div>

  ${renderFlash(flash)}

  <div class="cards">
    <div class="card accent"><div class="label">Saldo atual</div><div class="val">${fmtInt(user.credits)}</div><div class="hint">${fmtInt(Math.floor(user.credits / 5))} imagens</div></div>
    <div class="card"><div class="label">Créditos gastos</div><div class="val">${fmtInt(totals.spent)}</div></div>
    <div class="card"><div class="label">Imagens geradas</div><div class="val">${fmtInt(totals.generations)}</div></div>
    <div class="card ok"><div class="label">Receita</div><div class="val">${esc(fmtBrl(totals.revenue))}</div><div class="hint">${orders.length} pedidos</div></div>
  </div>

  <section>
    <h2>Ações</h2>
    <div style="display:flex;gap:16px;padding:16px;flex-wrap:wrap;align-items:flex-end">
      <form class="form" style="padding:0" method="post" action="${base}/credits">
        <input type="hidden" name="telegram_id" value="${user.telegram_id}">
        <input type="hidden" name="return" value="${backReturn}">
        <div class="field">
          <label>Ajustar créditos (+/-)</label>
          <input name="amount" type="number" required placeholder="50 ou -10" autofocus>
        </div>
        <button class="btn primary" type="submit">Aplicar</button>
      </form>
      <form method="post" action="${base}/ban" onsubmit="return confirm('${banConfirm}')">
        <input type="hidden" name="telegram_id" value="${user.telegram_id}">
        <input type="hidden" name="banned" value="${user.banned ? '0' : '1'}">
        <input type="hidden" name="return" value="${backReturn}">
        <button class="${banButtonClass}" type="submit">${banButtonLabel}</button>
      </form>
    </div>
  </section>

  <section>
    <h2>Pedidos</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Order ID</th><th>Pacote</th><th class="num">Créditos</th><th class="num">Valor</th><th>Quando</th></tr></thead>
        <tbody>${ordersRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Gerações (últimas 100)</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th></th><th>Prompt</th><th class="num">Créditos</th><th>Quando</th></tr></thead>
        <tbody>${gensRows}</tbody>
      </table>
    </div>
  </section>

  <div class="foot">HOT Admin</div>
</div>
</body>
</html>`;
}

export function renderNotFound(basePath: string): string {
  const base = baseHref(basePath);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Não encontrado</title><style>${SHARED_STYLES}</style></head>
<body><div class="wrap"><h1>Não encontrado</h1><p><a href="${base}/">← Voltar ao dashboard</a></p></div></body>
</html>`;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

export function ordersToCsv(rows: AdminOrder[]): string {
  const header = csvLine([
    'order_id',
    'telegram_id',
    'pkg_id',
    'credits',
    'amount_brl',
    'created_at',
  ]);
  const body = rows.map((o) =>
    csvLine([
      o.order_id,
      o.telegram_id,
      o.pkg_id,
      o.credits,
      o.amount,
      isoDate(o.created_at),
    ])
  );
  return [header, ...body].join('\n') + '\n';
}

export function generationsToCsv(rows: AdminGeneration[]): string {
  const header = csvLine([
    'id',
    'telegram_id',
    'prompt',
    'credits_spent',
    'created_at',
  ]);
  const body = rows.map((g) =>
    csvLine([
      g.id,
      g.telegram_id,
      g.prompt,
      g.credits_spent,
      isoDate(g.created_at),
    ])
  );
  return [header, ...body].join('\n') + '\n';
}
