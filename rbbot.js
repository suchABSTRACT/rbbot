/**
 * Riftbound Telegram Bot — rbbot
 */

const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
const RIFTCODEX_BASE = "https://api.riftcodex.com";
const RAPIDAPI_HOST = "riftbound-prices-api.p.rapidapi.com";

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

// ─── Price Lookup by Card Name (TCGGO / RapidAPI) ─────────────────────────────
async function lookupPrice(cardName) {
  if (!RAPIDAPI_KEY) return null;

  const headers = {
    "X-RapidAPI-Key": RAPIDAPI_KEY,
    "X-RapidAPI-Host": RAPIDAPI_HOST,
  };

  // TCGGO's own IDs are different from TCGPlayer IDs, so we must search by name
  try {
    const query = encodeURIComponent(cardName.replace(/[,]/g, "").trim());
    const url = `https://${RAPIDAPI_HOST}/api/v1/cards?search=${query}`;
    console.log(`[price] GET ${url}`);
    const res = await fetch(url, { headers });
    const json = await res.json();
    console.log(`[price] Response: ${JSON.stringify(json).slice(0, 400)}`);

    const cards = json.data ?? json.cards ?? json.items ?? (Array.isArray(json) ? json : null);
    if (!cards || cards.length === 0) return null;

    // Match against the base name (before " - " or "," since TCGGO uses short names like "Jinx")
    const baseName = cardName.split(/[-,]/)[0].trim().toLowerCase();
    const match = cards.find((c) => c.name?.toLowerCase().includes(baseName)) ?? cards[0];

    return match?.prices ?? null;
  } catch (err) {
    console.error(`[price] Error:`, err.message);
    return null;
  }
}

// ─── Format Price Lines ───────────────────────────────────────────────────────
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
      // First get the card data (we need the tcgplayer_id for pricing)
      const card = await lookupCard(name);

      if (!card) {
        await bot.sendMessage(chatId,
          `❌ Card not found: *${esc(name)}*\nCheck the spelling and try again\.`,
          { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }
        );
        continue;
      }

      // Search pricing API by name (TCGGO uses its own internal IDs, not TCGPlayer IDs)
      const prices = await lookupPrice(card.name);

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
