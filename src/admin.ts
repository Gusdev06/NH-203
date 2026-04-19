import type { AdminStats } from './db.ts';

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
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
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

export function renderAdminDashboard(stats: AdminStats): string {
  const { totals, recentUsers, recentGenerations, recentOrders } = stats;
  const chart = renderChart(stats.dailyGenerations);
  const now = fmtDate(Date.now());

  const usersRows = recentUsers.length
    ? recentUsers
        .map(
          (u) => `
        <tr>
          <td class="mono">${u.telegram_id}</td>
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
          <td class="mono">${g.telegram_id}</td>
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
          <td class="mono">${o.telegram_id ?? '—'}</td>
          <td>${esc(o.pkg_id ?? '—')}</td>
          <td class="num">${fmtInt(o.credits)}</td>
          <td class="num">${esc(fmtBrl(o.amount))}</td>
          <td>${esc(fmtDate(o.created_at))}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="empty">Nenhum pedido ainda</td></tr>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>HOT — Admin</title>
<style>
  :root{
    --bg:#0b0b0e;--card:#15151a;--border:#26262e;--fg:#e5e5ea;--muted:#7a7a85;
    --accent:#ff6b35;--ok:#3ecf8e;--warn:#eab308;--danger:#ef4444;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:1200px;margin:0 auto;padding:24px}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:13px;margin-bottom:24px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px}
  .card .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
  .card .val{font-size:24px;font-weight:600;line-height:1}
  .card .hint{color:var(--muted);font-size:11px;margin-top:6px}
  .card.accent .val{color:var(--accent)}
  .card.ok .val{color:var(--ok)}
  .card.warn .val{color:var(--warn)}
  section{background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:16px;overflow:hidden}
  section h2{font-size:12px;margin:0;padding:12px 16px;border-bottom:1px solid var(--border);
    color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:500}
  .tablewrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:10px 16px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
  th{color:var(--muted);font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.06em;
    background:#111117}
  tr:last-child td{border-bottom:none}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .chart{display:flex;align-items:flex-end;gap:6px;padding:16px 16px 8px;height:140px}
  .bar{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;position:relative;
    opacity:.78;transition:opacity .15s}
  .bar:hover{opacity:1}
  .bar .tip{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);
    background:#000;color:#fff;padding:4px 8px;font-size:11px;border-radius:4px;white-space:nowrap;
    pointer-events:none;opacity:0;margin-bottom:6px;transition:opacity .15s}
  .bar:hover .tip{opacity:1}
  .daylabels{display:flex;gap:6px;padding:0 16px 14px;font-size:10px;color:var(--muted)}
  .daylabels div{flex:1;text-align:center}
  .empty{padding:20px 16px;color:var(--muted);font-size:13px;text-align:center}
  .prompt{max-width:380px;overflow:hidden;text-overflow:ellipsis;color:#aaa;white-space:nowrap}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .foot{text-align:center;color:var(--muted);font-size:11px;margin-top:24px}
</style>
</head>
<body>
<div class="wrap">
  <h1>🔥 HOT — Admin</h1>
  <div class="sub">Atualizado ${esc(now)} • recarrega a cada 30s</div>

  <div class="cards">
    <div class="card"><div class="label">Usuários</div><div class="val">${fmtInt(totals.users)}</div></div>
    <div class="card warn"><div class="label">Créditos em circulação</div><div class="val">${fmtInt(totals.creditsOutstanding)}</div><div class="hint">≈ ${fmtInt(Math.floor(totals.creditsOutstanding / 5))} imagens pagas</div></div>
    <div class="card ok"><div class="label">Receita total</div><div class="val">${esc(fmtBrl(totals.revenueBrl))}</div><div class="hint">${fmtInt(totals.ordersCount)} pedidos</div></div>
    <div class="card accent"><div class="label">Gerações hoje</div><div class="val">${fmtInt(totals.generationsToday)}</div></div>
    <div class="card"><div class="label">Gerações totais</div><div class="val">${fmtInt(totals.generationsOk)}</div><div class="hint">${fmtInt(totals.generationsFailed)} falhas</div></div>
  </div>

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
