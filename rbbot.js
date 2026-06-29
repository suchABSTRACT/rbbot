/**
 * Riftbound Telegram Bot — rbbot
 *
 * Setup:
 *   1. npm install node-telegram-bot-api node-fetch
 *   2. Set BOT_TOKEN and RAPIDAPI_KEY as environment variables in Railway.
 *   3. node rbbot.js
 *
 * Usage in Telegram group:
 *   [[Irelia, Fervent]]
 *   [[Master Yi]] [[Jinx]]   ← multiple cards in one message
 *   /rbbot [[Irelia, Fervent]]
 */

const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
const RIFTCODEX_BASE = "https://api.riftcodex.com";
const RAPIDAPI_HOST = "riftbound-prices-api.p.rapidapi.com";
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}/api/v1`;

// ─── Bot Setup ────────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── Escape special characters for Telegram MarkdownV2 ───────────────────────
function esc(text) {
  if (!text) return "";
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

// ─── Replace Riftbound symbol tags with emoji ─────────────────────────────────
function replaceSymbols(text) {
  if (!text) return "";
  return text
    .replace(/:rb_rune_rainbow:/gi, "🔮")
    .replace(/:rb_rune_fury:/gi,    "🔴")
    .replace(/:rb_rune_calm:/gi,    "🔵")
    .replace(/:rb_rune_mind:/gi,    "🟣")
    .replace(/:rb_rune_body:/gi,    "🟢")
    .replace(/:rb_rune_chaos:/gi,   "🟤")
    .replace(/:rb_rune_order:/gi,   "🟡")
    .replace(/:rb_might:/gi,        "⚔️")
    .replace(/:rb_energy:/gi,       "⚡")
    .replace(/:rb_power:/gi,        "💎")
    .replace(/:rb_[a-z_]+:/gi, "");
}

// ─── Strip HTML tags from rich text ──────────────────────────────────────────
function stripHtml(str) {
  if (!str) return "";
  return str
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// ─── Card Lookup (Riftcodex) ──────────────────────────────────────────────────
async function lookupCard(cardName) {
  const name = cardName.trim();
  const queryParam = name.replace(/[,]/g, "").replace(/\s+/g, "+");

  // 1. Exact match
  try {
    const url = `${RIFTCODEX_BASE}/cards/name?exact=${queryParam}`;
    console.log(`[exact] GET ${url}`);
    const res = await fetch(url);
    const json = await res.json();
    console.log(`[exact] Response: ${JSON.stringify(json).slice(0, 400)}`);
    const cards = json.items ?? json.data ?? (Array.isArray(json) ? json : null);
    if (cards && cards.length > 0) return cards[0];
    if (json.name) return json;
  } catch (err) {
    console.error("[exact] Error:", err.message);
  }

  // 2. Fuzzy match
  try {
    const url = `${RIFTCODEX_BASE}/cards/name?fuzzy=${queryParam}`;
    console.log(`[fuzzy] GET ${url}`);
    const res = await fetch(url);
    const json = await res.json();
    console.log(`[fuzzy] Response: ${JSON.stringify(json).slice(0, 400)}`);
    const cards = json.items ?? json.data ?? (Array.isArray(json) ? json : null);
    if (cards && cards.length > 0) return cards[0];
    if (json.name) return json;
  } catch (err) {
    console.error("[fuzzy] Error:", err.message);
  }

  // 3. General search fallback
  try {
    const url = `${RIFTCODEX_BASE}/cards/search?query=${queryParam}`;
    console.log(`[search] GET ${url}`);
    const res = await fetch(url);
    const json = await res.json();
    console.log(`[search] Response: ${JSON.stringify(json).slice(0, 400)}`);
    const cards = json.items ?? json.data ?? (Array.isArray(json) ? json : null);
    if (cards && cards.length > 0) return cards[0];
  } catch (err) {
    console.error("[search] Error:", err.message);
  }

  return null;
}

// ─── Price Lookup (TCGGO / RapidAPI) ─────────────────────────────────────────
async function lookupPrice(cardName) {
  if (!RAPIDAPI_KEY) return null;

  try {
    const query = cardName.replace(/[,]/g, "").replace(/\s+/g, "+");
    const url = `${RAPIDAPI_BASE}/cards?search=${query}`;
    console.log(`[price] GET ${url}`);
    const res = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
      },
    });
    const json = await res.json();
    console.log(`[price] Response: ${JSON.stringify(json).slice(0, 400)}`);

    // Find the best matching card by name
    const cards = json.data ?? json.cards ?? (Array.isArray(json) ? json : null);
    if (!cards || cards.length === 0) return null;

    const nameLower = cardName.toLowerCase().replace(/[,]/g, "");
    const match = cards.find((c) =>
      c.name?.toLowerCase().replace(/[,]/g, "").includes(nameLower.split("+")[0])
    ) ?? cards[0];

    return match?.prices ?? null;
  } catch (err) {
    console.error("[price] Error:", err.message);
    return null;
  }
}

// ─── Format Price Line ────────────────────────────────────────────────────────
function formatPrices(prices) {
  if (!prices) return null;

  const lines = [];

  const tcgMarket = prices?.tcgplayer?.market;
  const tcgLow = prices?.tcgplayer?.low;
  if (tcgMarket != null || tcgLow != null) {
    let line = "💵 TCGPlayer:";
    if (tcgMarket != null) line += ` $${tcgMarket.toFixed(2)}`;
    if (tcgLow != null) line += ` \\(low $${tcgLow.toFixed(2)}\\)`;
    lines.push(line);
  }

  const cmTrend = prices?.cardmarket?.trend;
  const cmLow = prices?.cardmarket?.low;
  if (cmTrend != null || cmLow != null) {
    let line = "🌍 Cardmarket:";
    if (cmTrend != null) line += ` €${cmTrend.toFixed(2)}`;
    if (cmLow != null) line += ` \\(low €${cmLow.toFixed(2)}\\)`;
    lines.push(line);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// ─── Build Caption (MarkdownV2) ───────────────────────────────────────────────
function buildCaption(card, prices) {
  const name = card.name ?? "Unknown";
  const type = card.classification?.type ?? "";
  const supertype = card.classification?.supertype ?? "";
  const rarity = card.classification?.rarity ?? "";
  const domain = (card.classification?.domain ?? []).join(", ");
  const energy = card.attributes?.energy;
  const might = card.attributes?.might;
  const power = card.attributes?.power;
  const set = card.set?.label ?? card.set?.set_id ?? "";

  const rawText = card.text?.plain
    ? replaceSymbols(card.text.plain)
    : replaceSymbols(stripHtml(card.text?.rich ?? ""));
  const flavour = replaceSymbols(card.text?.flavour ?? "");

  const typeLine = [supertype, type].filter(Boolean).join(" ");
  const stats = [
    energy != null ? `⚡ ${energy}` : null,
    might != null ? `⚔️ ${might}` : null,
    power != null ? `🛡️ ${power}` : null,
  ].filter(Boolean).join("  ");

  let caption = `*${esc(name)}*`;
  if (typeLine) caption += `\n_${esc(typeLine)}_`;
  if (rarity || domain) caption += `\n${esc([rarity, domain].filter(Boolean).join(" · "))}`;
  if (stats) caption += `\n${stats}`;
  if (set) caption += `\n📦 ${esc(set)}`;
  if (rawText) caption += `\n\n${esc(rawText.slice(0, 500))}`;
  if (flavour) caption += `\n\n_${esc(flavour.slice(0, 150))}_`;

  // Pricing section
  const priceLines = formatPrices(prices);
  if (priceLines) caption += `\n\n${priceLines}`;

  return caption;
}

// ─── Extract [[Card Names]] from message ──────────────────────────────────────
function extractCardNames(text) {
  const matches = [...text.matchAll(/\[\[(.+?)\]\]/g)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

// ─── Message Handler ──────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const text = msg.text ?? "";
  const chatId = msg.chat.id;

  const isCommand = text.startsWith("/rbbot");
  const hasBrackets = /\[\[.+?\]\]/.test(text);
  if (!isCommand && !hasBrackets) return;

  const cardNames = extractCardNames(text);
  if (cardNames.length === 0) {
    if (isCommand) {
      bot.sendMessage(chatId,
        "Usage: `[[Card Name]]` or `/rbbot [[Card Name]]`\nExample: `[[Irelia, Fervent]]`",
        { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }
      );
    }
    return;
  }

  for (const name of cardNames.slice(0, 5)) {
    try {
      // Fetch card data and prices in parallel
      const [card, prices] = await Promise.all([
        lookupCard(name),
        lookupPrice(name),
      ]);

      if (!card) {
        await bot.sendMessage(chatId,
          `❌ Card not found: *${esc(name)}*\nCheck the spelling and try again\.`,
          { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }
        );
        continue;
      }

      const imageUrl = card.media?.image_url;
      const caption = buildCaption(card, prices);

      if (imageUrl) {
        await bot.sendPhoto(chatId, imageUrl, {
          caption,
          parse_mode: "MarkdownV2",
          reply_to_message_id: msg.message_id,
        });
      } else {
        await bot.sendMessage(chatId, caption, {
          parse_mode: "MarkdownV2",
          reply_to_message_id: msg.message_id,
        });
      }
    } catch (err) {
      console.error(`Error looking up "${name}":`, err.message);
      await bot.sendMessage(chatId,
        `⚠️ Error fetching *${esc(name)}*\. Try again later\.`,
        { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }
      );
    }
  }
});

console.log("✅ RBBot is running. Listening for [[card lookups]]...");
