import 'dotenv/config';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { run, sequentialize } from '@grammyjs/runner';
import {
  ensureUser,
  getCredits,
  debitCredits,
  refundCredits,
  logGeneration,
  isBanned,
  updateUserProfile,
} from './db.ts';
import { generateImage } from './replicate.ts';
import {
  PACKAGES,
  findPackage,
  formatBrl,
  CREDITS_PER_IMAGE as PKG_CREDITS_PER_IMAGE,
} from './packages.ts';
import { getOffer } from './cakto-offers.ts';
import { startServer } from './server.ts';

const CREDITS_PER_IMAGE = 5;

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN não configurado no .env');
if (!process.env.REPLICATE_API_TOKEN)
  throw new Error('REPLICATE_API_TOKEN não configurado no .env');

const bot = new Bot(token);

bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

const profileThrottle = new Map<number, number>();
const PROFILE_TTL = 5 * 60 * 1000;

bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) {
    const now = Date.now();
    const last = profileThrottle.get(ctx.from.id) ?? 0;
    if (now - last > PROFILE_TTL) {
      profileThrottle.set(ctx.from.id, now);
      updateUserProfile(ctx.from.id, {
        username: ctx.from.username ?? null,
        firstName: ctx.from.first_name ?? null,
        lastName: ctx.from.last_name ?? null,
        isPremium: ctx.from.is_premium === true,
        languageCode: ctx.from.language_code ?? null,
      });
    }
  }
  await next();
});

bot.use(async (ctx, next) => {
  const id = ctx.from?.id;
  if (id && isBanned(id)) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery('⛔ Conta bloqueada.').catch(() => { });
    } else if (ctx.message) {
      await ctx
        .reply('⛔ Sua conta está bloqueada. Entre em contato com o suporte.')
        .catch(() => { });
    }
    return;
  }
  await next();
});

type PendingState =
  | { step: 'await_input' }
  | { step: 'await_edit_prompt'; imageUrl: string };

const pending = new Map<number, PendingState>();
const generating = new Set<number>();
const lastGenerated = new Map<number, string>();

const HD_URL_CAP = 2000;
const hdUrls = new Map<string, string>();

function saveHdUrl(url: string): string {
  const token =
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4);
  hdUrls.set(token, url);
  if (hdUrls.size > HD_URL_CAP) {
    const firstKey = hdUrls.keys().next().value;
    if (firstKey) hdUrls.delete(firstKey);
  }
  return token;
}

function resultKeyboard(token: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⬇️ Baixar HD', `gen:hd:${token}`)
    .row()
    .text('✏️ Editar esta', 'gen:edit')
    .text('🙈 Esconder', `gen:hide:${token}`)
    .row()
    .text('🎨 Gerar outra', 'menu:gerar')
    .text('🏠 Menu', 'menu:home');
}

async function getTelegramFileUrl(ctx: Context, fileId: string): Promise<string | null> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) return null;
  return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
}

// ───────────────────── helpers ─────────────────────

function mainMenu(credits: number): { text: string; keyboard: InlineKeyboard } {
  const text =
    `🔥 <b>HOT</b> — gerador de imagens IA\n\n` +
    `💎 Seus créditos: <b>${credits}</b>\n` +
    `🎨 Cada geração custa <b>${CREDITS_PER_IMAGE} créditos</b>\n\n` +
    `Escolha uma opção abaixo:`;
  const keyboard = new InlineKeyboard()
    .text('🎨 Gerar imagem', 'menu:gerar')
    .row()
    .text('💳 Comprar créditos', 'menu:comprar')
    .text('💎 Meu saldo', 'menu:saldo')
    .row()
    .text('❓ Ajuda', 'menu:ajuda');
  return { text, keyboard };
}

function packagesMessage(): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  for (const pkg of PACKAGES) {
    const bonusCredits = pkg.bonusImages
      ? pkg.bonusImages * PKG_CREDITS_PER_IMAGE
      : 0;
    const bonusLabel = bonusCredits ? ` 🎁 +${bonusCredits}` : '';
    const label = `${formatBrl(pkg.priceBrl)} • ${pkg.credits} créditos${bonusLabel}`;
    keyboard.text(label, `buy:${pkg.id}`).row();
  }
  keyboard.text('⬅️ Voltar', 'menu:home');
  return { text: '💳 <b>Pacotes de créditos</b>', keyboard };
}

async function editOrReply(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard
) {
  const options = {
    parse_mode: 'HTML' as const,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  };
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch {
      /* fallback to reply */
    }
  }
  await ctx.reply(text, options);
}

async function showHome(ctx: Context, id: number) {
  ensureUser(id);
  const { text, keyboard } = mainMenu(getCredits(id));
  await editOrReply(ctx, text, keyboard);
}

async function showPackages(ctx: Context) {
  const { text, keyboard } = packagesMessage();
  await editOrReply(ctx, text, keyboard);
}

async function showSaldo(ctx: Context, id: number) {
  ensureUser(id);
  const credits = getCredits(id);
  const text =
    `💎 <b>Seu saldo</b>\n\n` +
    `Créditos: <b>${credits}</b>`;
  const kb = new InlineKeyboard()
    .text('🎨 Gerar agora', 'menu:gerar')
    .text('💳 Comprar mais', 'menu:comprar')
    .row()
    .text('⬅️ Voltar', 'menu:home');
  await editOrReply(ctx, text, kb);
}

async function showAjuda(ctx: Context) {
  const text =
    `❓ <b>Como funciona</b>\n\n` +
    `1️⃣ Compre créditos (a partir de R$ 25)\n` +
    `2️⃣ Toque em <b>Gerar imagem</b>\n` +
    `3️⃣ Envie uma imagem de referência (opcional)\n` +
    `4️⃣ Descreva o que quer na imagem\n` +
    `5️⃣ Receba em segundos!\n\n` +
    `⚡ Cada geração usa <b>${CREDITS_PER_IMAGE} créditos</b>\n` +
    `<b>Comandos</b>\n` +
    `/gerar — abrir fluxo de geração\n` +
    `/saldo — ver créditos\n` +
    `/comprar — comprar pacote\n` +
    `/cancelar — abortar fluxo atual\n` +
    `/start — voltar ao menu`;
  const kb = new InlineKeyboard().text('⬅️ Voltar', 'menu:home');
  await editOrReply(ctx, text, kb);
}

async function startGenerate(ctx: Context, id: number) {
  ensureUser(id);
  if (getCredits(id) < CREDITS_PER_IMAGE) {
    const kb = new InlineKeyboard()
      .text('💳 Comprar créditos', 'menu:comprar')
      .row()
      .text('⬅️ Voltar', 'menu:home');
    await editOrReply(
      ctx,
      `⚠️ <b>Créditos insuficientes</b>\n\n` +
      `Você tem <b>${getCredits(id)}</b>, precisa de <b>${CREDITS_PER_IMAGE}</b>.`,
      kb
    );
    return;
  }
  pending.set(id, { step: 'await_input' });
  const kb = new InlineKeyboard().text('❌ Cancelar', 'gen:cancel');
  await editOrReply(
    ctx,
    `🎨 <b>Nova geração</b>\n\n` +
    `Agora envie <b>uma única mensagem</b>:\n` +
    `• <b>Imagem + legenda</b> (a legenda é o prompt), ou\n` +
    `• <b>Apenas texto</b> (sem imagem de referência)\n\n` +
    `💡 Pra enviar imagem com prompt: anexe a foto e digite a descrição no campo de legenda antes de mandar.`,
    kb
  );
}

// ───────────────────── commands ─────────────────────

bot.command('start', async (ctx) => {
  const id = ctx.from!.id;
  const { isNew } = ensureUser(id);
  if (isNew) {
    await ctx.reply(
      `🔥 <b>Bem-vindo ao HOT!</b>\n\nGere imagens incríveis com IA. Compre créditos pra começar.`,
      { parse_mode: 'HTML' }
    );
  }
  await showHome(ctx, id);
});

bot.command(['menu', 'home'], (ctx) => showHome(ctx, ctx.from!.id));
bot.command('saldo', (ctx) => showSaldo(ctx, ctx.from!.id));
bot.command('comprar', (ctx) => showPackages(ctx));
bot.command('ajuda', (ctx) => showAjuda(ctx));
bot.command('gerar', (ctx) => startGenerate(ctx, ctx.from!.id));

bot.command('cancelar', async (ctx) => {
  const id = ctx.from!.id;
  if (pending.delete(id)) {
    await ctx.reply('❌ Fluxo cancelado.');
  } else {
    await ctx.reply('Nada pra cancelar.');
  }
});

// ───────────────────── callbacks ─────────────────────

bot.callbackQuery('menu:home', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showHome(ctx, ctx.from!.id);
});

bot.callbackQuery('menu:gerar', async (ctx) => {
  await ctx.answerCallbackQuery();
  await startGenerate(ctx, ctx.from!.id);
});

bot.callbackQuery('menu:comprar', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPackages(ctx);
});

bot.callbackQuery('menu:saldo', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showSaldo(ctx, ctx.from!.id);
});

bot.callbackQuery('menu:ajuda', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showAjuda(ctx);
});

bot.callbackQuery('gen:cancel', async (ctx) => {
  const id = ctx.from!.id;
  pending.delete(id);
  await ctx.answerCallbackQuery('Cancelado');
  await showHome(ctx, id);
});

bot.callbackQuery(/^gen:hide:(.+)$/, async (ctx) => {
  const token = ctx.match[1];
  const msg = ctx.callbackQuery.message;
  const photos = msg && 'photo' in msg ? msg.photo : undefined;
  if (!photos || photos.length === 0) {
    await ctx.answerCallbackQuery('Nada pra esconder.');
    return;
  }
  const fileId = photos[photos.length - 1].file_id;
  await ctx.answerCallbackQuery();

  await ctx.replyWithPhoto(fileId, {
    caption: '🙈 <b>Escondida</b> — toque na imagem pra revelar.',
    parse_mode: 'HTML',
    has_spoiler: true,
    reply_markup: resultKeyboard(token),
  });
  await ctx.deleteMessage().catch(() => { });
});

bot.callbackQuery(/^gen:hd:(.+)$/, async (ctx) => {
  const token = ctx.match[1];
  const url = hdUrls.get(token);
  if (!url) {
    await ctx.answerCallbackQuery(
      'Versão HD não está mais disponível. Gere a imagem novamente.'
    );
    return;
  }
  await ctx.answerCallbackQuery('Enviando HD...');
  try {
    await ctx.replyWithDocument(url, {
      caption: '🖼 <b>HD</b> — sem compressão',
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('Erro ao enviar HD:', err);
    await ctx.reply(
      '❌ Não consegui enviar a versão HD. Tenta de novo em alguns segundos.'
    );
  }
});

bot.callbackQuery('gen:edit', async (ctx) => {
  const id = ctx.from!.id;
  ensureUser(id);
  const lastUrl = lastGenerated.get(id);
  if (!lastUrl) {
    await ctx.answerCallbackQuery('Nenhuma imagem pra editar.');
    return;
  }
  if (getCredits(id) < CREDITS_PER_IMAGE) {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text('💳 Comprar créditos', 'menu:comprar')
      .row()
      .text('🏠 Menu', 'menu:home');
    await ctx.reply(
      `⚠️ <b>Créditos insuficientes</b>\n\nVocê tem <b>${getCredits(id)}</b>, precisa de <b>${CREDITS_PER_IMAGE}</b>.`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }
  pending.set(id, { step: 'await_edit_prompt', imageUrl: lastUrl });
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard().text('❌ Cancelar', 'gen:cancel');
  await ctx.reply(
    `✏️ <b>Editar imagem</b>\n\nDescreva em texto o que você quer mudar na última imagem gerada. (Ex: "troque o fundo por uma praia", "adicione óculos escuros")`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

bot.callbackQuery(/^buy:(.+)$/, async (ctx) => {
  const pkgId = ctx.match[1];
  const pkg = findPackage(pkgId);
  if (!pkg) {
    await ctx.answerCallbackQuery('Pacote inválido.');
    return;
  }
  const offer = getOffer(pkgId);
  await ctx.answerCallbackQuery();

  if (!offer) {
    await ctx.reply('⚠️ Checkout ainda não configurado.');
    return;
  }

  const userId = ctx.from!.id;
  const tag = `tg_${userId}_${pkgId}`;
  const checkoutUrl =
    `${offer.url}?utm_source=telegram&utm_campaign=hot_bot` +
    `&utm_content=${tag}&sck=${tag}&src=${tag}`;

  const kb = new InlineKeyboard()
    .url(`💳 Pagar ${formatBrl(pkg.priceBrl)}`, checkoutUrl)
    .row()
    .text('⬅️ Outros pacotes', 'menu:comprar');

  const bonusCredits = pkg.bonusImages
    ? pkg.bonusImages * PKG_CREDITS_PER_IMAGE
    : 0;
  const bonusLabel = bonusCredits ? ` 🎁 +${bonusCredits} créditos bônus` : '';
  await editOrReply(
    ctx,
    `📦 <b>${pkg.credits} créditos</b> — <b>${formatBrl(pkg.priceBrl)}</b>${bonusLabel}\n\n` +
    `Toque no botão abaixo pra pagar via <b>PIX</b> ou <b>cartão</b>. ` +
    `Seus créditos são adicionados automaticamente assim que o pagamento for aprovado.`,
    kb
  );
});

// ───────────────────── message handlers ─────────────────────

bot.on(
  [
    'message:video',
    'message:audio',
    'message:voice',
    'message:video_note',
    'message:animation',
    'message:document',
    'message:sticker',
  ],
  async (ctx) => {
    const id = ctx.from!.id;
    const kb = pending.has(id)
      ? new InlineKeyboard().text('❌ Cancelar', 'gen:cancel')
      : new InlineKeyboard()
        .text('🎨 Gerar imagem', 'menu:gerar')
        .text('🏠 Menu', 'menu:home');
    await ctx.reply(
      '⚠️ Só aceito <b>imagem</b> (foto) ou <b>texto</b>. Toque em <b>🎨 Gerar imagem</b> e envie uma foto com legenda ou apenas texto.',
      { parse_mode: 'HTML', reply_markup: kb }
    );
  }
);

bot.on('message:photo', async (ctx) => {
  const id = ctx.from!.id;
  const state = pending.get(id);
  if (!state) {
    const kb = new InlineKeyboard()
      .text('🎨 Gerar imagem', 'menu:gerar')
      .text('🏠 Menu', 'menu:home');
    await ctx.reply(
      `👋 Pra começar uma geração, toque em <b>🎨 Gerar imagem</b> (ou use /gerar). ` +
      `Depois reenvie sua foto com a descrição na <b>legenda</b>.`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }

  if (state.step === 'await_edit_prompt') {
    await ctx.reply(
      '✏️ Pra editar, envie apenas o <b>texto</b> descrevendo a mudança.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const caption = ctx.message.caption?.trim();
  if (!caption) {
    const kb = new InlineKeyboard().text('❌ Cancelar', 'gen:cancel');
    await ctx.reply(
      '⚠️ Falta o <b>prompt</b>. Reenvie a imagem colocando a descrição no campo de <b>legenda</b>.',
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }

  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];
  const imageUrl = await getTelegramFileUrl(ctx, largest.file_id);
  if (!imageUrl) {
    await ctx.reply('❌ Não consegui baixar sua imagem. Tenta de novo.');
    return;
  }

  pending.delete(id);
  await handleGenerate(ctx, id, caption, imageUrl);
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const id = ctx.from!.id;
  const state = pending.get(id);
  if (!state) {
    const kb = new InlineKeyboard()
      .text('🎨 Gerar imagem', 'menu:gerar')
      .text('🏠 Menu', 'menu:home');
    await ctx.reply(
      `👋 Pra gerar uma imagem, toque em <b>🎨 Gerar imagem</b> (ou use /gerar) antes de enviar o prompt.`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }
  const text = ctx.message.text.trim();
  if (state.step === 'await_edit_prompt') {
    const imageUrl = state.imageUrl;
    pending.delete(id);
    await handleGenerate(ctx, id, text, imageUrl);
    return;
  }
  pending.delete(id);
  await handleGenerate(ctx, id, text);
});

const MAX_PROMPT_LENGTH = 2000;

async function handleGenerate(
  ctx: Context,
  id: number,
  prompt: string,
  imageUrl?: string
) {
  if (generating.has(id)) {
    await ctx.reply(
      '⏳ Aguarda a geração atual terminar antes de pedir outra.'
    );
    return;
  }

  if (!prompt || prompt.length < 2) {
    await ctx.reply('⚠️ Prompt muito curto. Descreva o que você quer gerar.');
    return;
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    await ctx.reply(
      `⚠️ Prompt muito longo (máx ${MAX_PROMPT_LENGTH} caracteres).`
    );
    return;
  }

  if (!debitCredits(id, CREDITS_PER_IMAGE)) {
    await ctx.reply(
      `⚠️ Créditos insuficientes. Você tem ${getCredits(id)}, precisa de ${CREDITS_PER_IMAGE}.`
    );
    return;
  }

  generating.add(id);
  const statusMsg = await ctx.reply('🎨 Gerando sua imagem... (30–60s)');
  try {
    const out = await generateImage(prompt, imageUrl ? [imageUrl] : undefined);
    logGeneration(id, prompt, CREDITS_PER_IMAGE);
    lastGenerated.set(id, out);

    const remaining = getCredits(id);
    const token = saveHdUrl(out);
    const kb = resultKeyboard(token);

    await ctx.replyWithPhoto(out, {
      caption:
        `✨ <b>Pronto!</b> Toque na imagem pra revelar.\n\n` +
        `💬 <i>${prompt.slice(0, 200)}</i>\n\n` +
        `💎 Restam <b>${remaining}</b> créditos`,
      parse_mode: 'HTML',
      has_spoiler: true,
      reply_markup: kb,
    });
    await ctx.api
      .deleteMessage(statusMsg.chat.id, statusMsg.message_id)
      .catch(() => { });
  } catch (err) {
    refundCredits(id, CREDITS_PER_IMAGE);
    logGeneration(id, prompt, 0);
    console.error('Erro na geração:', err);
    const kb = new InlineKeyboard().text('🔄 Tentar de novo', 'menu:gerar');
    await ctx.reply(
      '❌ Erro ao gerar. Seus créditos foram devolvidos.\n\nTente novamente ou mude o prompt.',
      { reply_markup: kb }
    );
  } finally {
    generating.delete(id);
  }
}

bot.catch((err) => console.error('Bot error:', err));

startServer(bot);

bot.api
  .setMyCommands([
    { command: 'start', description: 'Menu principal' },
    { command: 'gerar', description: 'Gerar uma imagem' },
    { command: 'saldo', description: 'Ver meus créditos' },
    { command: 'comprar', description: 'Comprar créditos' },
    { command: 'ajuda', description: 'Como funciona' },
    { command: 'cancelar', description: 'Cancelar fluxo ativo' },
  ])
  .catch((err) => console.warn('Falha ao setar comandos:', err));

const telegramSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const webhookBaseUrl = process.env.WEBHOOK_BASE_URL?.replace(/\/$/, '');

async function start() {
  await bot.init();
  const username = bot.botInfo.username;

  if (telegramSecret && webhookBaseUrl) {
    const url = `${webhookBaseUrl}/telegram/${telegramSecret}`;
    await bot.api.setWebhook(url, {
      secret_token: telegramSecret,
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query'],
    });
    console.log(`🔥 Bot @${username} rodando (webhook → ${url})`);
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => { });
    run(bot);
    console.log(`🔥 Bot @${username} rodando (long polling)`);
  }
}

start().catch((err) => {
  console.error('Falha ao iniciar bot:', err);
  process.exit(1);
});
