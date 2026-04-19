import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Bot } from 'grammy';
import { handleCaktoWebhook } from './webhook.ts';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function startServer(bot: Bot): void {
  const port = Number(process.env.WEBHOOK_PORT ?? 3000);
  const secret = process.env.CAKTO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('⚠️  CAKTO_WEBHOOK_SECRET não configurado — webhook desativado.');
    return;
  }

  const webhookPath = `/webhook/cakto/${secret}`;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }

    if (req.method === 'POST' && req.url === webhookPath) {
      try {
        const body = await readBody(req);
        const result = await handleCaktoWebhook(bot, body);
        res.writeHead(result.httpStatus, { 'Content-Type': 'text/plain' });
        res.end(result.body);
      } catch (err) {
        console.error('[server] erro no webhook:', err);
        res.writeHead(500).end('error');
      }
      return;
    }

    res.writeHead(404).end('not found');
  });

  server.listen(port, () => {
    console.log(`🌐 Webhook ouvindo em http://localhost:${port}${webhookPath}`);
  });
}
