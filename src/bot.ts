import 'dotenv/config';
import { existsSync } from 'node:fs';
import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy';
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
  findPackage,
  formatPrice,
  packagesFor,
  currencyForLanguage,
  type Currency,
  CREDITS_PER_IMAGE as PKG_CREDITS_PER_IMAGE,
} from './packages.ts';
import { getOffer } from './perfectpay-offers.ts';
import { startServer } from './server.ts';

const CREDITS_PER_IMAGE = 5;

type Lang = 'pt' | 'en';

function langFromCurrency(c: Currency): Lang {
  return c === 'BRL' ? 'pt' : 'en';
}

function getCurrency(ctx: Context): Currency {
  return currencyForLanguage(ctx.from?.language_code);
}

function getLang(ctx: Context): Lang {
  return langFromCurrency(getCurrency(ctx));
}

const STR = {
  welcome: {
    pt: '📸 Manda a foto da garota que você quer ver sem roupa. 😈😈',
    en: '📸 Send the photo of the girl you want to see naked. 😈😈',
  },
  menuTitle: {
    pt: '🔥 <b>HOT</b>\n\nEscolha uma opção:',
    en: '🔥 <b>HOT</b>\n\nChoose an option:',
  },
  undress: { pt: '🔥 Undress', en: '🔥 Undress' },
  faceswap: { pt: '🔄 Face Swap', en: '🔄 Face Swap' },
  undressTitle: {
    pt: '🔥 <b>Undress</b>\n\nEnvie <b>1 foto</b> da pessoa.\n\n⚡ Custa <b>5 créditos</b>.',
    en: '🔥 <b>Undress</b>\n\nSend <b>1 photo</b> of the person.\n\n⚡ Costs <b>5 credits</b>.',
  },
  faceswapTitle: {
    pt: '🔄 <b>Face Swap</b>\n\nEnvie <b>2 fotos</b>:\n• 1ª foto: rosto (de onde vem a face)\n• 2ª foto: corpo/cena (onde a face vai)\n\n💡 Pode mandar as duas juntas ou uma de cada vez.\n\n⚡ Custa <b>5 créditos</b>.',
    en: '🔄 <b>Face Swap</b>\n\nSend <b>2 photos</b>:\n• 1st photo: face source\n• 2nd photo: target body/scene\n\n💡 You can send both at once or one at a time.\n\n⚡ Costs <b>5 credits</b>.',
  },
  faceswapWaiting: {
    pt: '📸 Foto 1/2 recebida. Agora envie a <b>2ª foto</b>.',
    en: '📸 Photo 1/2 received. Now send the <b>2nd photo</b>.',
  },
  buy: { pt: '💳 Comprar créditos', en: '💳 Buy credits' },
  balance: { pt: '💎 Meu saldo', en: '💎 My balance' },
  help: { pt: '❓ Ajuda', en: '❓ Help' },
  back: { pt: '⬅️ Voltar', en: '⬅️ Back' },
  home: { pt: '🏠 Menu', en: '🏠 Menu' },
  cancel: { pt: '❌ Cancelar', en: '❌ Cancel' },
  packagesTitle: { pt: '💳 <b>Pacotes de créditos</b>', en: '💳 <b>Credit packages</b>' },
  insufficientTitle: { pt: '⚠️ <b>Créditos insuficientes</b>', en: '⚠️ <b>Insufficient credits</b>' },
  insufficient: (have: number, need: number, lang: Lang) =>
    lang === 'pt'
      ? `Você tem <b>${have}</b>, precisa de <b>${need}</b>.`
      : `You have <b>${have}</b>, need <b>${need}</b>.`,
  balanceTitle: { pt: '💎 <b>Seu saldo</b>', en: '💎 <b>Your balance</b>' },
  credits: { pt: 'Créditos', en: 'Credits' },
  buyMore: { pt: '💳 Comprar mais', en: '💳 Buy more' },
  generating: {
    pt: '✨ Gerando sua imagem... (30–60s)',
    en: '✨ Generating your image... (30–60s)',
  },
  generationError: {
    pt: '❌ Erro ao gerar. Seus créditos foram devolvidos.\n\nTente novamente.',
    en: '❌ Generation error. Your credits were refunded.\n\nTry again.',
  },
  resultCaption: (remaining: number, lang: Lang) =>
    lang === 'pt'
      ? `✨ <b>Pronto!</b> Toque na imagem pra revelar.\n\n💎 Restam <b>${remaining}</b> créditos`
      : `✨ <b>Done!</b> Tap the image to reveal.\n\n💎 <b>${remaining}</b> credits left`,
  editPhoto: { pt: '✏️ Editar foto', en: '✏️ Edit photo' },
  redo: { pt: '🔄 Refazer geração', en: '🔄 Regenerate' },
  redoUnavailable: {
    pt: 'Esta geração não está mais disponível para refazer.',
    en: 'This generation is no longer available to redo.',
  },
  editTitle: {
    pt: '✏️ <b>Editar foto</b>\n\nManda em texto o que você quer mudar nessa imagem.\n\nEx: "troca o fundo por uma praia", "adiciona óculos escuros", "muda a cor do cabelo pra ruivo".\n\n⚡ Custa <b>5 créditos</b>.',
    en: '✏️ <b>Edit photo</b>\n\nSend a text describing what to change in this image.\n\nEx: "change the background to a beach", "add sunglasses", "change hair color to red".\n\n⚡ Costs <b>5 credits</b>.',
  },
  editUnavailable: {
    pt: 'Imagem não está mais disponível para edição. Gere uma nova.',
    en: 'Image no longer available for editing. Generate a new one.',
  },
  cancelled: { pt: '❌ Fluxo cancelado.', en: '❌ Flow cancelled.' },
  cancelledToast: { pt: 'Cancelado', en: 'Cancelled' },
  blocked: { pt: '⛔ Conta bloqueada.', en: '⛔ Account blocked.' },
  downloadFail: {
    pt: '❌ Não consegui baixar sua imagem. Tenta de novo.',
    en: '❌ Could not download your image. Try again.',
  },
  helpText: (lang: Lang) =>
    lang === 'pt'
      ? `❓ <b>Como funciona</b>\n\n1️⃣ Compre créditos\n2️⃣ Manda a foto que quer melhorar (4K automático)\n3️⃣ Ou escolha: 🔥 Undress / 🔄 Face Swap\n\n⚡ Cada geração usa <b>${CREDITS_PER_IMAGE} créditos</b>\n\n<b>Comandos</b>\n/start — menu principal\n/undress — fluxo undress\n/faceswap — fluxo face swap\n/saldo — ver créditos\n/comprar — comprar pacote\n/cancelar — abortar fluxo atual`
      : `❓ <b>How it works</b>\n\n1️⃣ Buy credits\n2️⃣ Send the photo you want to enhance (auto 4K)\n3️⃣ Or pick: 🔥 Undress / 🔄 Face Swap\n\n⚡ Each generation uses <b>${CREDITS_PER_IMAGE} credits</b>\n\n<b>Commands</b>\n/start — main menu\n/undress — undress flow\n/faceswap — face swap flow\n/balance — see credits\n/buy — buy a package\n/cancel — abort current flow`,
};

function s<K extends keyof typeof STR>(
  key: K,
  lang: Lang
): typeof STR[K] extends Record<Lang, string> ? string : never {
  const entry = STR[key] as { pt: string; en: string };
  return entry[lang] as never;
}

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
      const lang = getLang(ctx);
      await ctx.answerCallbackQuery(s('blocked', lang)).catch(() => { });
    }
    return;
  }
  await next();
});

type PendingState =
  | { step: 'await_undress_photo' }
  | { step: 'await_faceswap_photos'; collected: string[]; pendingTimer?: ReturnType<typeof setTimeout> }
  | { step: 'await_edit_prompt'; imageUrl: string };

const pending = new Map<number, PendingState>();
const generating = new Set<number>();

const MAX_REFERENCE_IMAGES = 2;
const MEDIA_GROUP_WAIT_MS = 1500;

const ENHANCE_PROMPT =
  'Deixa essa mulher completamente pelada, mantenha o rosto original e o corpo, os seios e a bunda devem ficar bem avantajados e sedutores, mantenha a iluminação e o fundo original.';

const UNDRESS_PROMPT =
  'Remove all clothing from the person in the image. Show them fully nude. Keep the original face, body, pose, lighting and background. Photorealistic, natural skin tone and anatomy.';

const FACESWAP_PROMPT =
  'Photorealistic face and hair swap. The ONLY thing that changes in the second image is the face and the hair — everything else must remain pixel-perfect identical to the original second image. Take the exact facial identity from the first image — eyes, nose, mouth, eyebrows, face shape, jawline and overall likeness — together with the hair (same hairstyle, length, color, texture and hairline) and naturally apply both to the person in the second image. Adapt the head proportions so the new face and hair fit the body naturally. STRICTLY PRESERVE every other detail of the second image exactly as it is: the body, skin tone of the body, pose, clothing (every fold, texture, color and accessory), background (every object, person, furniture, wall, floor, decoration), environment, scene, framing, camera angle, focal length, depth of field, bokeh, composition, image grain, image noise, color grading, lighting setup, shadows, highlights, reflections and overall mood. Do not add, remove, move or alter any object, person or element. Do not change the resolution, aspect ratio, crop, perspective or post-processing of the second image. Match the new face and hair perfectly to the second image\'s lighting direction, color temperature, shadows, highlights and ambient tone so it blends as if it was always there. Seamless blending at the jawline, neck and hairline with no visible seams, color shifts or edges. Natural skin and hair texture with realistic pores, individual hair strands and subtle imperfections matching the exact detail level of the rest of the photo. No plastic or airbrushed look, no AI artifacts, no symmetry errors, no scene reinterpretation. The expression should fit the body pose naturally. Hyperrealistic, indistinguishable from the original second image except for the new face and hair.';

function clearPending(id: number) {
  const state = pending.get(id);
  if (state?.step === 'await_faceswap_photos' && state.pendingTimer) {
    clearTimeout(state.pendingTimer);
  }
  return pending.delete(id);
}

const notifiedGroups = new Set<string>();
function markGroupNotified(groupId: string) {
  notifiedGroups.add(groupId);
  setTimeout(() => notifiedGroups.delete(groupId), 5000);
}

const GEN_CAP = 2000;
type GenerationContext = {
  outputUrl: string;
  prompt: string;
  inputUrls?: string[];
};
const generations = new Map<string, GenerationContext>();

function saveGeneration(ctx: GenerationContext): string {
  const t =
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4);
  generations.set(t, ctx);
  if (generations.size > GEN_CAP) {
    const firstKey = generations.keys().next().value;
    if (firstKey) generations.delete(firstKey);
  }
  return t;
}

function resultKeyboard(genToken: string, lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(s('redo', lang), `gen:redo:${genToken}`)
    .text(s('editPhoto', lang), `gen:edit:${genToken}`)
    .row()
    .text(s('home', lang), 'menu:home');
}

async function getTelegramFileUrl(ctx: Context, fileId: string): Promise<string | null> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) return null;
  return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
}

// ───────────────────── helpers ─────────────────────

function mainMenu(lang: Lang): { text: string; keyboard: InlineKeyboard } {
  const text = s('menuTitle', lang);
  const keyboard = new InlineKeyboard()
    .text(s('undress', lang), 'menu:undress')
    .text(s('faceswap', lang), 'menu:faceswap')
    .row()
    .text(s('balance', lang), 'menu:saldo')
    .text(s('buy', lang), 'menu:comprar')
    .row()
    .text(s('help', lang), 'menu:ajuda');
  return { text, keyboard };
}

function packagesMessage(currency: Currency, lang: Lang): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  const creditsLabel = lang === 'pt' ? 'créditos' : 'credits';
  for (const pkg of packagesFor(currency)) {
    const bonusCredits = pkg.bonusImages ? pkg.bonusImages * PKG_CREDITS_PER_IMAGE : 0;
    const bonusLabel = bonusCredits ? ` 🎁 +${bonusCredits}` : '';
    const label = `${formatPrice(pkg.price, pkg.currency)} • ${pkg.credits} ${creditsLabel}${bonusLabel}`;
    keyboard.text(label, `buy:${pkg.id}`).row();
  }
  keyboard.text(s('back', lang), 'menu:home');
  return { text: s('packagesTitle', lang), keyboard };
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
  const lang = getLang(ctx);
  const { text, keyboard } = mainMenu(lang);
  await editOrReply(ctx, text, keyboard);
}

async function showPackages(ctx: Context) {
  const lang = getLang(ctx);
  const currency = getCurrency(ctx);
  const { text, keyboard } = packagesMessage(currency, lang);
  await editOrReply(ctx, text, keyboard);
}

async function showSaldo(ctx: Context, id: number) {
  ensureUser(id);
  const lang = getLang(ctx);
  const credits = getCredits(id);
  const text = `${s('balanceTitle', lang)}\n\n${s('credits', lang)}: <b>${credits}</b>`;
  const kb = new InlineKeyboard()
    .text(s('buyMore', lang), 'menu:comprar')
    .row()
    .text(s('back', lang), 'menu:home');
  await editOrReply(ctx, text, kb);
}

async function showAjuda(ctx: Context) {
  const lang = getLang(ctx);
  const kb = new InlineKeyboard().text(s('back', lang), 'menu:home');
  await editOrReply(ctx, STR.helpText(lang), kb);
}

async function notifyInsufficient(ctx: Context, id: number) {
  const lang = getLang(ctx);
  const kb = new InlineKeyboard()
    .text(s('buy', lang), 'menu:comprar')
    .row()
    .text(s('home', lang), 'menu:home');
  await ctx.reply(
    `${s('insufficientTitle', lang)}\n\n${STR.insufficient(getCredits(id), CREDITS_PER_IMAGE, lang)}`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
}

async function startUndress(ctx: Context, id: number) {
  ensureUser(id);
  const lang = getLang(ctx);
  if (getCredits(id) < CREDITS_PER_IMAGE) {
    await notifyInsufficient(ctx, id);
    return;
  }
  clearPending(id);
  pending.set(id, { step: 'await_undress_photo' });
  const kb = new InlineKeyboard().text(s('cancel', lang), 'gen:cancel');
  await editOrReply(ctx, s('undressTitle', lang), kb);
}

async function startFaceswap(ctx: Context, id: number) {
  ensureUser(id);
  const lang = getLang(ctx);
  if (getCredits(id) < CREDITS_PER_IMAGE) {
    await notifyInsufficient(ctx, id);
    return;
  }
  clearPending(id);
  pending.set(id, { step: 'await_faceswap_photos', collected: [] });
  const kb = new InlineKeyboard().text(s('cancel', lang), 'gen:cancel');
  await editOrReply(ctx, s('faceswapTitle', lang), kb);
}

// ───────────────────── commands ─────────────────────

const welcomeVideoSource = process.env.WELCOME_VIDEO?.trim();
let cachedWelcomeVideoFileId: string | undefined;

async function sendWelcomeVideo(ctx: Context) {
  if (!welcomeVideoSource) return;
  try {
    let media: string | InputFile;
    if (cachedWelcomeVideoFileId) {
      media = cachedWelcomeVideoFileId;
    } else if (/^https?:\/\//i.test(welcomeVideoSource)) {
      media = welcomeVideoSource;
    } else if (existsSync(welcomeVideoSource)) {
      media = new InputFile(welcomeVideoSource);
    } else {
      media = welcomeVideoSource;
    }
    const msg = await ctx.replyWithVideo(media, { has_spoiler: true });
    if (!cachedWelcomeVideoFileId && msg.video?.file_id) {
      cachedWelcomeVideoFileId = msg.video.file_id;
    }
  } catch (err) {
    console.warn('[welcome-video] falha ao enviar:', err);
  }
}

bot.command('start', async (ctx) => {
  const id = ctx.from!.id;
  ensureUser(id);
  clearPending(id);
  const lang = getLang(ctx);
  await sendWelcomeVideo(ctx);
  await ctx.reply(s('welcome', lang), { parse_mode: 'HTML' });
});

bot.command(['menu', 'home'], (ctx) => {
  clearPending(ctx.from!.id);
  return showHome(ctx, ctx.from!.id);
});
bot.command(['saldo', 'balance'], (ctx) => showSaldo(ctx, ctx.from!.id));
bot.command(['comprar', 'buy'], (ctx) => showPackages(ctx));
bot.command(['ajuda', 'help'], (ctx) => showAjuda(ctx));
bot.command('undress', (ctx) => startUndress(ctx, ctx.from!.id));
bot.command('faceswap', (ctx) => startFaceswap(ctx, ctx.from!.id));

bot.command(['cancelar', 'cancel'], async (ctx) => {
  const id = ctx.from!.id;
  const lang = getLang(ctx);
  if (clearPending(id)) {
    await ctx.reply(s('cancelled', lang));
  }
  await showHome(ctx, id);
});

// ───────────────────── callbacks ─────────────────────

bot.callbackQuery('menu:home', async (ctx) => {
  clearPending(ctx.from!.id);
  await ctx.answerCallbackQuery();
  await showHome(ctx, ctx.from!.id);
});

bot.callbackQuery('menu:undress', async (ctx) => {
  await ctx.answerCallbackQuery();
  await startUndress(ctx, ctx.from!.id);
});

bot.callbackQuery('menu:faceswap', async (ctx) => {
  await ctx.answerCallbackQuery();
  await startFaceswap(ctx, ctx.from!.id);
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
  const lang = getLang(ctx);
  clearPending(id);
  await ctx.answerCallbackQuery(s('cancelledToast', lang));
  await showHome(ctx, id);
});

bot.callbackQuery(/^gen:edit:(.+)$/, async (ctx) => {
  const id = ctx.from!.id;
  ensureUser(id);
  const t = ctx.match[1];
  const gen = generations.get(t);
  const lang = getLang(ctx);
  if (!gen) {
    await ctx.answerCallbackQuery(s('editUnavailable', lang));
    return;
  }
  if (getCredits(id) < CREDITS_PER_IMAGE) {
    await ctx.answerCallbackQuery();
    await notifyInsufficient(ctx, id);
    return;
  }
  clearPending(id);
  pending.set(id, { step: 'await_edit_prompt', imageUrl: gen.outputUrl });
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard().text(s('cancel', lang), 'gen:cancel');
  await ctx.reply(s('editTitle', lang), { parse_mode: 'HTML', reply_markup: kb });
});

bot.callbackQuery(/^gen:redo:(.+)$/, async (ctx) => {
  const id = ctx.from!.id;
  ensureUser(id);
  const t = ctx.match[1];
  const gen = generations.get(t);
  const lang = getLang(ctx);
  if (!gen) {
    await ctx.answerCallbackQuery(s('redoUnavailable', lang));
    return;
  }
  if (getCredits(id) < CREDITS_PER_IMAGE) {
    await ctx.answerCallbackQuery();
    await notifyInsufficient(ctx, id);
    return;
  }
  await ctx.answerCallbackQuery();
  clearPending(id);
  await handleGenerate(ctx, id, gen.prompt, gen.inputUrls);
});

bot.callbackQuery(/^buy:(.+)$/, async (ctx) => {
  const pkgId = ctx.match[1];
  const pkg = findPackage(pkgId);
  const lang = getLang(ctx);
  if (!pkg) {
    await ctx.answerCallbackQuery(lang === 'pt' ? 'Pacote inválido.' : 'Invalid package.');
    return;
  }

  const userId = ctx.from!.id;
  const bonusCredits = pkg.bonusImages
    ? pkg.bonusImages * PKG_CREDITS_PER_IMAGE
    : 0;
  const creditsWord = lang === 'pt' ? 'créditos' : 'credits';
  const bonusLabel = bonusCredits
    ? lang === 'pt'
      ? ` 🎁 +${bonusCredits} créditos bônus`
      : ` 🎁 +${bonusCredits} bonus credits`
    : '';

  // Perfect Pay external checkout (BRL or USD)
  const offer = getOffer(pkgId);
  await ctx.answerCallbackQuery();

  if (!offer) {
    await ctx.reply(lang === 'pt' ? '⚠️ Checkout ainda não configurado.' : '⚠️ Checkout not configured yet.');
    return;
  }

  const tag = `tg_${userId}_${pkgId}`;
  const checkoutUrl =
    `${offer.url}?utm_source=telegram&utm_campaign=hot_bot` +
    `&utm_content=${tag}&src=${tag}`;

  const priceLabel = formatPrice(pkg.price, pkg.currency);
  const payLabel = lang === 'pt' ? `💳 Pagar ${priceLabel}` : `💳 Pay ${priceLabel}`;
  const otherPkgsLabel = lang === 'pt' ? '⬅️ Outros pacotes' : '⬅️ Other packages';

  const kb = new InlineKeyboard()
    .url(payLabel, checkoutUrl)
    .row()
    .text(otherPkgsLabel, 'menu:comprar');

  const payMethods = pkg.currency === 'BRL'
    ? (lang === 'pt' ? '<b>PIX</b> ou <b>cartão</b>' : '<b>PIX</b> or <b>card</b>')
    : (lang === 'pt' ? '<b>cartão</b>' : '<b>card</b>');

  const body = lang === 'pt'
    ? `Toque no botão abaixo pra pagar via ${payMethods}. Seus créditos são adicionados automaticamente assim que o pagamento for aprovado.`
    : `Tap the button below to pay by ${payMethods}. Your credits are added automatically as soon as the payment is approved.`;
  await editOrReply(
    ctx,
    `📦 <b>${pkg.credits} ${creditsWord}</b> — <b>${priceLabel}</b>${bonusLabel}\n\n${body}`,
    kb
  );
});

// ───────────────────── message handlers ─────────────────────

// Non-photo media: silent. Bot only responds to commands, buttons and photos.
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
  async () => { /* silent */ }
);

bot.on('message:photo', async (ctx) => {
  const id = ctx.from!.id;
  ensureUser(id);
  const state = pending.get(id);
  const groupId = ctx.message.media_group_id;

  // Faceswap collects across photos via state
  if (state?.step === 'await_faceswap_photos') {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = undefined;
    }
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    const imageUrl = await getTelegramFileUrl(ctx, largest.file_id);
    if (!imageUrl) {
      const lang = getLang(ctx);
      await ctx.reply(s('downloadFail', lang));
      return;
    }
    state.collected.push(imageUrl);

    if (state.collected.length >= 2) {
      if (groupId) markGroupNotified(groupId);
      const refs = state.collected.slice(0, 2);
      clearPending(id);
      await handleGenerate(ctx, id, FACESWAP_PROMPT, refs);
      return;
    }

    const lang = getLang(ctx);
    if (groupId) {
      state.pendingTimer = setTimeout(async () => {
        const current = pending.get(id);
        if (current?.step !== 'await_faceswap_photos') return;
        await ctx.reply(s('faceswapWaiting', lang), { parse_mode: 'HTML' }).catch(() => { });
      }, MEDIA_GROUP_WAIT_MS);
    } else {
      await ctx.reply(s('faceswapWaiting', lang), { parse_mode: 'HTML' });
    }
    return;
  }

  // Single-photo flows (undress, enhance): ignore extra siblings in same group
  if (groupId) {
    if (notifiedGroups.has(groupId)) return;
    markGroupNotified(groupId);
  }

  if (getCredits(id) < CREDITS_PER_IMAGE) {
    await notifyInsufficient(ctx, id);
    return;
  }

  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];
  const imageUrl = await getTelegramFileUrl(ctx, largest.file_id);
  if (!imageUrl) {
    const lang = getLang(ctx);
    await ctx.reply(s('downloadFail', lang));
    return;
  }

  if (state?.step === 'await_undress_photo') {
    clearPending(id);
    await handleGenerate(ctx, id, UNDRESS_PROMPT, [imageUrl]);
    return;
  }

  // Default flow: enhance to 4K
  clearPending(id);
  await handleGenerate(ctx, id, ENHANCE_PROMPT, [imageUrl]);
});

// Text is silent except when user is in await_edit_prompt (opted in via Editar foto button).
bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const id = ctx.from!.id;
  const state = pending.get(id);
  if (state?.step !== 'await_edit_prompt') return;
  const text = ctx.message.text.trim();
  if (text.length < 2) return;
  const imageUrl = state.imageUrl;
  clearPending(id);
  await handleGenerate(ctx, id, text, [imageUrl]);
});

const MAX_PROMPT_LENGTH = 2000;

async function handleGenerate(
  ctx: Context,
  id: number,
  prompt: string,
  imageUrls?: string[]
) {
  const lang = getLang(ctx);

  if (generating.has(id)) {
    return;
  }

  if (!prompt || prompt.length < 2 || prompt.length > MAX_PROMPT_LENGTH) {
    return;
  }

  if (!debitCredits(id, CREDITS_PER_IMAGE)) {
    await notifyInsufficient(ctx, id);
    return;
  }

  const refs = imageUrls && imageUrls.length > 0
    ? imageUrls.slice(0, MAX_REFERENCE_IMAGES)
    : undefined;

  generating.add(id);
  const statusMsg = await ctx.reply(s('generating', lang));
  try {
    const out = await generateImage(prompt, refs);
    logGeneration(id, prompt, CREDITS_PER_IMAGE);

    const remaining = getCredits(id);
    const genToken = saveGeneration({ outputUrl: out, prompt, inputUrls: refs });
    const kb = resultKeyboard(genToken, lang);

    await ctx.replyWithPhoto(out, {
      caption: STR.resultCaption(remaining, lang),
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
    const kb = new InlineKeyboard().text(s('home', lang), 'menu:home');
    await ctx.reply(s('generationError', lang), { reply_markup: kb });
  } finally {
    generating.delete(id);
  }
}

bot.catch((err) => console.error('Bot error:', err));

startServer(bot);

const commandsEn = [
  { command: 'start', description: 'Main menu' },
  { command: 'undress', description: 'Undress (1 photo)' },
  { command: 'faceswap', description: 'Face Swap (2 photos)' },
  { command: 'balance', description: 'View my credits' },
  { command: 'buy', description: 'Buy credits' },
  { command: 'help', description: 'How it works' },
  { command: 'cancel', description: 'Cancel active flow' },
];
const commandsPt = [
  { command: 'start', description: 'Menu principal' },
  { command: 'undress', description: 'Undress (1 foto)' },
  { command: 'faceswap', description: 'Face Swap (2 fotos)' },
  { command: 'saldo', description: 'Ver meus créditos' },
  { command: 'comprar', description: 'Comprar créditos' },
  { command: 'ajuda', description: 'Como funciona' },
  { command: 'cancelar', description: 'Cancelar fluxo ativo' },
];
async function setCommandsWithRetry(attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await Promise.all([
        bot.api.setMyCommands(commandsEn),
        bot.api.setMyCommands(commandsPt, { language_code: 'pt' }),
      ]);
      return;
    } catch (err) {
      const last = i === attempts;
      console.warn(`Falha ao setar comandos (tentativa ${i}/${attempts}):`, err);
      if (last) return;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

const telegramSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const webhookBaseUrl = process.env.WEBHOOK_BASE_URL?.replace(/\/$/, '');

async function initWithRetry(attempts = 10): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await bot.init();
      return;
    } catch (err) {
      const last = i === attempts;
      console.warn(`bot.init() falhou (tentativa ${i}/${attempts}):`, err);
      if (last) throw err;
      await new Promise((r) => setTimeout(r, Math.min(2000 * i, 15000)));
    }
  }
}

async function setWebhookWithRetry(url: string, attempts = 10): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await bot.api.setWebhook(url, {
        secret_token: telegramSecret!,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query'],
      });
      return;
    } catch (err) {
      const last = i === attempts;
      console.warn(`setWebhook falhou (tentativa ${i}/${attempts}):`, err);
      if (last) throw err;
      await new Promise((r) => setTimeout(r, Math.min(2000 * i, 15000)));
    }
  }
}

async function start() {
  await initWithRetry();
  const username = bot.botInfo.username;

  setCommandsWithRetry();

  if (telegramSecret && webhookBaseUrl) {
    const url = `${webhookBaseUrl}/telegram/${telegramSecret}`;
    await setWebhookWithRetry(url);
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
