import type {
  AdminStats,
  AdminGeneration,
  AdminOrder,
  AdminUser,
  UserDetail,
  PackageSale,
  TopSpender,
} from './db.ts';

// ───────────────── helpers ─────────────────

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

function relative(ms: number | null): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mês`;
}

function fmtBrl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR');
}

function userDisplayName(u: AdminUser): string {
  const names = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  if (u.username && names) return `@${u.username} · ${names}`;
  if (u.username) return `@${u.username}`;
  if (names) return names;
  return `id ${u.telegram_id}`;
}

function userLink(u: AdminUser, base: string): string {
  const badges: string[] = [];
  if (u.banned) badges.push('<span class="badge banned">BAN</span>');
  if (u.is_premium) badges.push('<span class="badge premium">⭐</span>');
  const display = esc(userDisplayName(u));
  return `<a href="${base}/user/${u.telegram_id}" class="userlink">${display}</a> ${badges.join(' ')}`;
}

function userLinkById(
  id: number | null,
  base: string,
  cache: Map<number, AdminUser>
): string {
  if (!id) return '<span class="dim">—</span>';
  const u = cache.get(id);
  if (u) return userLink(u, base);
  return `<a href="${base}/user/${id}" class="mono dim">${id}</a>`;
}

function chartBars(
  data: { day: string; value: number }[],
  color: string
): { bars: string; labels: string } {
  const days: { day: string; value: number }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const byDay = new Map(data.map((d) => [d.day, d.value]));
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ day: key, value: byDay.get(key) ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.value));
  const bars = days
    .map((d) => {
      const h = Math.round((d.value / max) * 100);
      const date = new Date(d.day + 'T00:00:00');
      const label = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
      return `<div class="bar" style="height:${h}%;background:${color}"><span class="tip">${label}: ${fmtInt(d.value)}</span></div>`;
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

// ───────────────── styles ─────────────────

const SHARED_STYLES = `
  :root{
    --bg:#0a0a0d;--card:#15151c;--card2:#1a1a22;--border:#26262f;--fg:#e8e8ed;--muted:#8a8a95;
    --accent:#ff6b35;--accent-hover:#ff8257;--ok:#3ecf8e;--warn:#eab308;--danger:#ef4444;
    --purple:#a855f7;--blue:#3b82f6;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;font-size:14px}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:1280px;margin:0 auto;padding:24px}
  .topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:20px;flex-wrap:wrap}
  h1{font-size:24px;margin:0 0 4px;letter-spacing:-.01em;font-weight:600}
  .sub{color:var(--muted);font-size:12px}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:6px;background:#1c1c23;border:1px solid var(--border);
    color:var(--fg);padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;text-decoration:none;transition:all .15s;font-family:inherit}
  .btn:hover{background:#23232c;text-decoration:none;border-color:#3a3a44}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
  .btn.danger{background:var(--danger);border-color:var(--danger);color:#fff}
  .btn.danger:hover{background:#d63838;border-color:#d63838}
  .btn.ok{background:var(--ok);border-color:var(--ok);color:#fff}
  .btn.ok:hover{background:#2eb97c;border-color:#2eb97c}
  .btn.ghost{background:transparent}
  .btn.sm{padding:5px 11px;font-size:12px}
  .btn.xs{padding:3px 8px;font-size:11px;border-radius:6px}
  .flash{padding:12px 14px;border-radius:8px;margin-bottom:16px;font-size:13px}
  .flash.ok{background:rgba(62,207,142,.12);border:1px solid rgba(62,207,142,.3);color:var(--ok)}
  .flash.err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:var(--danger)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;position:relative;overflow:hidden}
  .card .label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;font-weight:500}
  .card .val{font-size:26px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}
  .card .hint{color:var(--muted);font-size:11px;margin-top:6px}
  .card.accent .val{color:var(--accent)}
  .card.ok .val{color:var(--ok)}
  .card.warn .val{color:var(--warn)}
  .card.danger .val{color:var(--danger)}
  .card.purple .val{color:var(--purple)}
  .card.blue .val{color:var(--blue)}
  section{background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:16px;overflow:hidden}
  section h2{font-size:11px;margin:0;padding:14px 16px;border-bottom:1px solid var(--border);
    color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:500;display:flex;justify-content:space-between;align-items:center}
  section h2 .count{background:#1c1c23;padding:2px 8px;border-radius:999px;font-size:10px;color:var(--fg)}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .row2 section{margin-bottom:0}
  @media(max-width:720px){.row2{grid-template-columns:1fr}}
  .form{padding:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
  .field{display:flex;flex-direction:column;gap:4px;min-width:140px}
  .field label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;font-weight:500}
  .field input,.field textarea{background:#0b0b0e;border:1px solid var(--border);color:var(--fg);padding:8px 10px;
    border-radius:6px;font-size:13px;font-family:inherit;width:100%}
  .field textarea{resize:vertical;min-height:60px}
  .field input:focus,.field textarea:focus{outline:none;border-color:var(--accent)}
  .presets{display:flex;gap:6px;flex-wrap:wrap;padding:12px 16px 0}
  .presets .label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;align-self:center;margin-right:4px}
  .tablewrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:10px 16px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;vertical-align:middle}
  th{color:var(--muted);font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.07em;background:#111117}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#17171f}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .chart{display:flex;align-items:flex-end;gap:6px;padding:16px 16px 8px;height:140px}
  .bar{flex:1;border-radius:3px 3px 0 0;min-height:2px;position:relative;opacity:.82;transition:opacity .15s}
  .bar:hover{opacity:1}
  .bar .tip{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#000;color:#fff;
    padding:4px 8px;font-size:11px;border-radius:4px;white-space:nowrap;pointer-events:none;opacity:0;margin-bottom:6px;transition:opacity .15s;z-index:10}
  .bar:hover .tip{opacity:1}
  .daylabels{display:flex;gap:6px;padding:0 16px 14px;font-size:10px;color:var(--muted)}
  .daylabels div{flex:1;text-align:center}
  .empty{padding:28px 16px;color:var(--muted);font-size:13px;text-align:center}
  .prompt{max-width:420px;overflow:hidden;text-overflow:ellipsis;color:#aaa;white-space:nowrap}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .dim{color:var(--muted)}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:500;
    text-transform:uppercase;letter-spacing:.05em;vertical-align:middle}
  .badge.banned{background:rgba(239,68,68,.15);color:var(--danger);border:1px solid rgba(239,68,68,.25)}
  .badge.premium{background:rgba(234,179,8,.15);color:var(--warn);border:1px solid rgba(234,179,8,.25)}
  .foot{text-align:center;color:var(--muted);font-size:11px;margin-top:24px}
  .userlink{font-weight:500}
  .search{padding:12px 16px;border-bottom:1px solid var(--border)}
  .search input{width:100%;background:#0b0b0e;border:1px solid var(--border);color:var(--fg);padding:8px 10px;
    border-radius:6px;font-size:13px;font-family:inherit}
  .search input:focus{outline:none;border-color:var(--accent)}
  .linkbtns{display:flex;gap:4px}
  .note{background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.2);padding:10px 14px;border-radius:6px;margin:0 16px 16px;color:#ddd;font-size:13px}
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

// ───────────────── dashboard ─────────────────

export function renderAdminDashboard(
  stats: AdminStats,
  basePath: string,
  flash: FlashMessages = {}
): string {
  const {
    totals,
    recentUsers,
    recentGenerations,
    recentOrders,
    topSpenders,
    unmatchedOrders,
    packageSales,
  } = stats;
  const base = baseHref(basePath);
  const now = fmtDate(Date.now());

  const userCache = new Map<number, AdminUser>();
  for (const u of recentUsers) userCache.set(u.telegram_id, u);
  for (const u of topSpenders) userCache.set(u.telegram_id, u);

  const genChart = chartBars(
    stats.dailyGenerations.map((d) => ({ day: d.day, value: d.count })),
    'var(--accent)'
  );
  const revChart = chartBars(
    stats.dailyRevenue.map((d) => ({ day: d.day, value: Math.round(d.revenue) })),
    'var(--ok)'
  );

  const usersRows = recentUsers.length
    ? recentUsers
        .map(
          (u) => `
        <tr>
          <td>${userLink(u, base)}</td>
          <td class="mono dim">${u.telegram_id}</td>
          <td class="num">${fmtInt(u.credits)}</td>
          <td class="dim">${relative(u.last_active)}</td>
          <td class="dim">${esc(fmtDate(u.created_at))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="empty">Nenhum usuário ainda</td></tr>`;

  const gensRows = recentGenerations.length
    ? recentGenerations
        .map((g) => {
          const ok = g.credits_spent > 0;
          return `
        <tr>
          <td>${ok ? '✅' : '❌'}</td>
          <td>${userLinkById(g.telegram_id, base, userCache)}</td>
          <td class="prompt" title="${esc(g.prompt)}">${esc(g.prompt)}</td>
          <td class="num">${g.credits_spent}</td>
          <td class="dim">${esc(fmtDate(g.created_at))}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="empty">Nenhuma geração ainda</td></tr>`;

  const ordersRows = recentOrders.length
    ? recentOrders
        .map(
          (o) => `
        <tr>
          <td class="mono dim" title="${esc(o.order_id)}">${esc(o.order_id.slice(0, 10))}…</td>
          <td>${userLinkById(o.telegram_id, base, userCache)}</td>
          <td>${esc(o.pkg_id ?? '—')}</td>
          <td class="num">${fmtInt(o.credits)}</td>
          <td class="num">${esc(fmtBrl(o.amount))}</td>
          <td class="dim">${esc(fmtDate(o.created_at))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="empty">Nenhum pedido ainda</td></tr>`;

  const topRows = topSpenders.length
    ? topSpenders
        .map(
          (u, i) => `
        <tr>
          <td class="dim">#${i + 1}</td>
          <td>${userLink(u, base)}</td>
          <td class="num">${fmtInt(u.orders_count)}</td>
          <td class="num">${esc(fmtBrl(u.total_spent))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="empty">Sem compras ainda</td></tr>`;

  const pkgRows = packageSales.length
    ? packageSales
        .map(
          (p: PackageSale) => `
        <tr>
          <td class="mono">${esc(p.pkg_id)}</td>
          <td class="num">${fmtInt(p.count)}</td>
          <td class="num">${fmtInt(p.credits)}</td>
          <td class="num">${esc(fmtBrl(p.revenue))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="empty">Nenhum pacote vendido</td></tr>`;

  const unmatchedRows = unmatchedOrders.length
    ? unmatchedOrders
        .map(
          (o) => `
        <tr>
          <td class="mono dim" title="${esc(o.order_id)}">${esc(o.order_id.slice(0, 10))}…</td>
          <td>${esc(o.pkg_id ?? '—')}</td>
          <td class="num">${esc(fmtBrl(o.amount))}</td>
          <td class="dim">${esc(fmtDate(o.created_at))}</td>
        </tr>`
        )
        .join('')
    : '';

  const unmatchedSection = unmatchedOrders.length
    ? `
  <section>
    <h2>⚠️ Pedidos órfãos (sem usuário vinculado) <span class="count">${unmatchedOrders.length}</span></h2>
    <div class="note">Estes pagamentos chegaram no webhook mas o sistema não conseguiu identificar o usuário do Telegram. Verifique os logs do webhook.</div>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Order ID</th><th>Pacote</th><th class="num">Valor</th><th>Quando</th></tr></thead>
        <tbody>${unmatchedRows}</tbody>
      </table>
    </div>
  </section>`
    : '';

  const autoRefresh = flash.ok || flash.err ? '' : '<meta http-equiv="refresh" content="30">';

  const conversion = totals.users > 0
    ? `${((totals.payingUsers / totals.users) * 100).toFixed(1)}%`
    : '0%';

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
      <a class="btn sm" href="${base}/users">👥 Todos os usuários</a>
      <a class="btn sm" href="${base}/export/orders.csv">⬇️ Pedidos CSV</a>
      <a class="btn sm" href="${base}/export/generations.csv">⬇️ Gerações CSV</a>
      <a class="btn sm" href="${base}/">🔄 Atualizar</a>
    </div>
  </div>

  ${renderFlash(flash)}

  <div class="cards">
    <div class="card ok">
      <div class="label">Receita total</div>
      <div class="val">${esc(fmtBrl(totals.revenueBrl))}</div>
      <div class="hint">${fmtInt(totals.ordersCount)} pedidos • hoje ${esc(fmtBrl(totals.revenueToday))}</div>
    </div>
    <div class="card accent">
      <div class="label">Gerações hoje</div>
      <div class="val">${fmtInt(totals.generationsToday)}</div>
      <div class="hint">${fmtInt(totals.generationsOk)} total • ${fmtInt(totals.generationsFailed)} falhas</div>
    </div>
    <div class="card blue">
      <div class="label">Usuários</div>
      <div class="val">${fmtInt(totals.users)}</div>
      <div class="hint">${fmtInt(totals.activeUsers7d)} ativos em 7d</div>
    </div>
    <div class="card purple">
      <div class="label">Convertidos</div>
      <div class="val">${conversion}</div>
      <div class="hint">${fmtInt(totals.payingUsers)} pagaram</div>
    </div>
    <div class="card warn">
      <div class="label">Créditos em circulação</div>
      <div class="val">${fmtInt(totals.creditsOutstanding)}</div>
      <div class="hint">≈ ${fmtInt(Math.floor(totals.creditsOutstanding / 5))} gerações pendentes</div>
    </div>
    <div class="card ${totals.unmatchedOrders > 0 ? 'danger' : ''}">
      <div class="label">Órfãos / Banidos</div>
      <div class="val">${fmtInt(totals.unmatchedOrders)} / ${fmtInt(totals.bannedUsers)}</div>
      <div class="hint">${fmtInt(totals.premiumUsers)} premium</div>
    </div>
  </div>

  <section>
    <h2>Adicionar / remover créditos</h2>
    <form class="form" method="post" action="${base}/credits">
      <input type="hidden" name="return" value="/">
      <div class="field" style="min-width:180px">
        <label>Telegram ID ou @username</label>
        <input name="target" type="text" required placeholder="123456789 ou @fulano">
      </div>
      <div class="field" style="min-width:140px">
        <label>Créditos (+/-)</label>
        <input name="amount" type="number" required placeholder="50 ou -10">
      </div>
      <button class="btn primary" type="submit">Aplicar</button>
    </form>
  </section>

  ${unmatchedSection}

  <div class="row2">
    <section>
      <h2>Gerações — últimos 14 dias <span class="count">${fmtInt(stats.dailyGenerations.reduce((s, d) => s + d.count, 0))}</span></h2>
      <div class="chart">${genChart.bars}</div>
      <div class="daylabels">${genChart.labels}</div>
    </section>
    <section>
      <h2>Receita — últimos 14 dias <span class="count">${esc(fmtBrl(stats.dailyRevenue.reduce((s, d) => s + d.revenue, 0)))}</span></h2>
      <div class="chart">${revChart.bars}</div>
      <div class="daylabels">${revChart.labels}</div>
    </section>
  </div>

  <div class="row2">
    <section>
      <h2>🏆 Top 10 compradores</h2>
      <div class="tablewrap">
        <table>
          <thead><tr><th></th><th>Usuário</th><th class="num">Pedidos</th><th class="num">Total gasto</th></tr></thead>
          <tbody>${topRows}</tbody>
        </table>
      </div>
    </section>
    <section>
      <h2>📦 Vendas por pacote</h2>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Pacote</th><th class="num">Vendas</th><th class="num">Créditos</th><th class="num">Receita</th></tr></thead>
          <tbody>${pkgRows}</tbody>
        </table>
      </div>
    </section>
  </div>

  <section>
    <h2>Pedidos recentes <span class="count">${recentOrders.length}</span></h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Order ID</th><th>Usuário</th><th>Pacote</th><th class="num">Créditos</th><th class="num">Valor</th><th>Quando</th></tr></thead>
        <tbody>${ordersRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Gerações recentes <span class="count">${recentGenerations.length}</span></h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th></th><th>Usuário</th><th>Prompt</th><th class="num">Créditos</th><th>Quando</th></tr></thead>
        <tbody>${gensRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Usuários recentes <span class="count">${recentUsers.length}</span></h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Usuário</th><th>ID</th><th class="num">Créditos</th><th>Visto</th><th>Entrou</th></tr></thead>
        <tbody>${usersRows}</tbody>
      </table>
    </div>
  </section>

  <div class="foot">HOT Admin • SQLite live view</div>
</div>
</body>
</html>`;
}

// ───────────────── user detail ─────────────────

export function renderUserDetail(
  detail: UserDetail,
  basePath: string,
  flash: FlashMessages = {}
): string {
  const base = baseHref(basePath);
  const { user, generations, orders, totals } = detail;
  const backReturn = `/user/${user.telegram_id}`;
  const displayName = userDisplayName(user);

  const preset = (amt: number) => `
    <form style="display:inline" method="post" action="${base}/credits">
      <input type="hidden" name="target" value="${user.telegram_id}">
      <input type="hidden" name="amount" value="${amt}">
      <input type="hidden" name="return" value="${backReturn}">
      <button class="btn xs ${amt > 0 ? 'ok' : 'danger'}" type="submit">${amt > 0 ? '+' : ''}${amt}</button>
    </form>`;

  const gensRows = generations.length
    ? generations
        .map((g: AdminGeneration) => {
          const ok = g.credits_spent > 0;
          return `
        <tr>
          <td>${ok ? '✅' : '❌'}</td>
          <td class="prompt" title="${esc(g.prompt)}">${esc(g.prompt)}</td>
          <td class="num">${g.credits_spent}</td>
          <td class="dim">${esc(fmtDate(g.created_at))}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="4" class="empty">Nenhuma geração</td></tr>`;

  const ordersRows = orders.length
    ? orders
        .map(
          (o: AdminOrder) => `
        <tr>
          <td class="mono dim" title="${esc(o.order_id)}">${esc(o.order_id.slice(0, 12))}…</td>
          <td>${esc(o.pkg_id ?? '—')}</td>
          <td class="num">${fmtInt(o.credits)}</td>
          <td class="num">${esc(fmtBrl(o.amount))}</td>
          <td class="dim">${esc(fmtDate(o.created_at))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="empty">Nenhum pedido</td></tr>`;

  const banButtonLabel = user.banned ? '🔓 Desbanir' : '🔒 Banir';
  const banButtonClass = user.banned ? 'btn' : 'btn danger';
  const banConfirm = user.banned
    ? 'Desbanir esse usuário?'
    : 'Banir esse usuário? Ele não conseguirá mais usar o bot.';

  const tgDeepLink = `tg://user?id=${user.telegram_id}`;
  const tgWebLink = user.username
    ? `https://t.me/${user.username}`
    : tgDeepLink;

  const premiumBadge = user.is_premium ? '<span class="badge premium">⭐ PREMIUM</span>' : '';
  const bannedBadge = user.banned ? '<span class="badge banned">BANIDO</span>' : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(displayName)} — HOT Admin</title>
<style>${SHARED_STYLES}</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div>
      <h1>${esc(displayName)} ${premiumBadge} ${bannedBadge}</h1>
      <div class="sub">
        <span class="mono">${user.telegram_id}</span>
        ${user.language_code ? `• lang: ${esc(user.language_code)}` : ''}
        • entrou ${esc(fmtDate(user.created_at))}
        ${user.last_active ? `• visto ${relative(user.last_active)} atrás` : ''}
      </div>
    </div>
    <div class="actions">
      <a class="btn sm" href="${tgWebLink}" target="_blank">💬 Abrir no Telegram</a>
      <a class="btn sm" href="${base}/">← Voltar</a>
    </div>
  </div>

  ${renderFlash(flash)}

  <div class="cards">
    <div class="card accent"><div class="label">Saldo atual</div><div class="val">${fmtInt(user.credits)}</div><div class="hint">créditos</div></div>
    <div class="card"><div class="label">Créditos gastos</div><div class="val">${fmtInt(totals.spent)}</div></div>
    <div class="card"><div class="label">Gerações</div><div class="val">${fmtInt(totals.generations)}</div></div>
    <div class="card ok"><div class="label">Receita</div><div class="val">${esc(fmtBrl(totals.revenue))}</div><div class="hint">${orders.length} pedidos</div></div>
  </div>

  <section>
    <h2>Ajustar créditos</h2>
    <div class="presets">
      <span class="label">Rápido:</span>
      ${preset(5)} ${preset(25)} ${preset(50)} ${preset(100)} ${preset(250)} ${preset(500)}
      ${preset(-5)} ${preset(-25)} ${preset(-100)}
    </div>
    <form class="form" method="post" action="${base}/credits">
      <input type="hidden" name="target" value="${user.telegram_id}">
      <input type="hidden" name="return" value="${backReturn}">
      <div class="field">
        <label>Valor customizado (+/-)</label>
        <input name="amount" type="number" required placeholder="ex: 75 ou -15" autofocus>
      </div>
      <button class="btn primary" type="submit">Aplicar</button>
    </form>
  </section>

  <section>
    <h2>Moderação</h2>
    <div class="form">
      <form method="post" action="${base}/ban" onsubmit="return confirm('${banConfirm}')">
        <input type="hidden" name="telegram_id" value="${user.telegram_id}">
        <input type="hidden" name="banned" value="${user.banned ? '0' : '1'}">
        <input type="hidden" name="return" value="${backReturn}">
        <button class="${banButtonClass}" type="submit">${banButtonLabel}</button>
      </form>
      <form method="post" action="${base}/note" style="flex:1;min-width:260px">
        <input type="hidden" name="telegram_id" value="${user.telegram_id}">
        <input type="hidden" name="return" value="${backReturn}">
        <div class="field">
          <label>Nota interna (só admin vê)</label>
          <input name="note" type="text" value="${esc(user.note ?? '')}" placeholder="ex: cliente VIP, reportou abuso...">
        </div>
        <button class="btn sm" type="submit">Salvar nota</button>
      </form>
    </div>
  </section>

  <section>
    <h2>Pedidos <span class="count">${orders.length}</span></h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Order ID</th><th>Pacote</th><th class="num">Créditos</th><th class="num">Valor</th><th>Quando</th></tr></thead>
        <tbody>${ordersRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Gerações (últimas 100) <span class="count">${generations.length}</span></h2>
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

// ───────────────── users list ─────────────────

export function renderUsersList(
  users: AdminUser[],
  basePath: string,
  search: string,
  flash: FlashMessages = {}
): string {
  const base = baseHref(basePath);

  const rows = users.length
    ? users
        .map(
          (u) => `
        <tr>
          <td>${userLink(u, base)}</td>
          <td class="mono dim">${u.telegram_id}</td>
          <td class="num">${fmtInt(u.credits)}</td>
          <td class="dim">${relative(u.last_active)}</td>
          <td class="dim">${esc(fmtDate(u.created_at))}</td>
          <td class="dim">${esc(u.note ?? '')}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="empty">Nenhum resultado</td></tr>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Usuários — HOT Admin</title>
<style>${SHARED_STYLES}</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div>
      <h1>👥 Usuários <span class="count" style="font-size:14px;background:#1c1c23;padding:4px 10px;border-radius:999px;margin-left:8px;">${fmtInt(users.length)}</span></h1>
      <div class="sub">Todos os usuários cadastrados</div>
    </div>
    <div class="actions">
      <a class="btn sm" href="${base}/">← Dashboard</a>
    </div>
  </div>

  ${renderFlash(flash)}

  <section>
    <div class="search">
      <form method="get" action="${base}/users">
        <input type="text" name="q" value="${esc(search)}" placeholder="🔍 Buscar por ID, @username, nome ou nota…" autofocus>
      </form>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Usuário</th><th>ID</th><th class="num">Créditos</th><th>Visto</th><th>Entrou</th><th>Nota</th></tr></thead>
        <tbody>${rows}</tbody>
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

// ───────────────── CSV ─────────────────

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
