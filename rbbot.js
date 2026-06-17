/**
 * Riftbound Telegram Bot — rbbot
 *
 * Setup:
 *   1. npm install node-telegram-bot-api node-fetch
 *   2. Create a bot via @BotFather on Telegram, get your token.
 *   3. Set your token below (or use an environment variable).
 *   4. Add the bot to your group and promote it (or just add it — no admin needed).
 *   5. node rbbot.js
 *
 * Usage in group:
 *   /rbbot [[Irelia, Fervent]]
 *   /rbbot [[Master Yi]] [[Jinx]]   ← multiple cards in one message
 *   [[Irelia, Fervent]]              ← also works without /rbbot command
 */

const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

// ─── Config ──────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const RIFTCODEX_BASE = "https://api.riftcodex.com";

// ─── Bot Setup ───────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── Card Lookup ─────────────────────────────────────────────────────────────
async function lookupCard(cardName) {
  const encoded = encodeURIComponent(cardName.trim());

  // Try exact match first, then fall back to fuzzy
  const exactUrl = `${RIFTCODEX_BASE}/cards/name?exact=${encoded}`;
  const fuzzyUrl = `${RIFTCODEX_BASE}/cards/name?fuzzy=${encoded}`;

  let card = null;

  try {
    const exactRes = await fetch(exactUrl);
    const exactData = await exactRes.json();
    const exactItems = exactData.items ?? exactData; // handle both array and paginated response
    if (Array.isArray(exactItems) && exactItems.length > 0) {
      card = exactItems[0];
    }
  } catch (_) {}

  if (!card) {
    try {
      const fuzzyRes = await fetch(fuzzyUrl);
      const fuzzyData = await fuzzyRes.json();
      const fuzzyItems = fuzzyData.items ?? fuzzyData;
      if (Array.isArray(fuzzyItems) && fuzzyItems.length > 0) {
        card = fuzzyItems[0];
      }
    } catch (_) {}
  }

  return card;
}

// ─── Format Card Caption ─────────────────────────────────────────────────────
function buildCaption(card) {
  const name = card.name ?? "Unknown";
  const type = card.classification?.type ?? "";
  const supertype = card.classification?.supertype ?? "";
  const rarity = card.classification?.rarity ?? "";
  const domain = (card.classification?.domain ?? []).join(", ");
  const energy = card.attributes?.energy ?? null;
  const might = card.attributes?.might ?? null;
  const power = card.attributes?.power ?? null;
  const set = card.set?.label ?? card.set?.set_id ?? "";
  const plainText = card.text?.plain ?? "";

  const typeLine = [supertype, type].filter(Boolean).join(" ");
  const stats = [
    energy != null ? `⚡ ${energy}` : null,
    might != null ? `⚔️ ${might}` : null,
    power != null ? `🛡️ ${power}` : null,
  ]
    .filter(Boolean)
    .join("  ");

  let caption = `*${name}*`;
  if (typeLine) caption += `\n_${typeLine}_`;
  if (rarity || domain) caption += `\n${[rarity, domain].filter(Boolean).join(" · ")}`;
  if (stats) caption += `\n${stats}`;
  if (set) caption += `\n📦 ${set}`;
  if (plainText) caption += `\n\n${plainText.slice(0, 800)}`; // Telegram caption limit

  return caption;
}

// ─── Extract [[Card Names]] from message text ─────────────────────────────────
function extractCardNames(text) {
  const matches = [...text.matchAll(/\[\[(.+?)\]\]/g)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

// ─── Message Handler ──────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const text = msg.text ?? "";
  const chatId = msg.chat.id;

  // Respond to /rbbot command OR any message containing [[...]]
  const isCommand = text.startsWith("/rbbot");
  const hasBrackets = /\[\[.+?\]\]/.test(text);

  if (!isCommand && !hasBrackets) return;

  const cardNames = extractCardNames(text);
  if (cardNames.length === 0) {
    if (isCommand) {
      bot.sendMessage(
        chatId,
        "Usage: `/rbbot [[Card Name]]` or just type `[[Card Name]]` anywhere in your message.",
        { parse_mode: "Markdown", reply_to_message_id: msg.message_id }
      );
    }
    return;
  }

  // Look up each card (max 5 per message to avoid spam)
  const toLookup = cardNames.slice(0, 5);

  for (const name of toLookup) {
    try {
      const card = await lookupCard(name);

      if (!card) {
        bot.sendMessage(chatId, `❌ Card not found: *${name}*`, {
          parse_mode: "Markdown",
          reply_to_message_id: msg.message_id,
        });
        continue;
      }

      const imageUrl = card.media?.image_url;
      const caption = buildCaption(card);

      if (imageUrl) {
        await bot.sendPhoto(chatId, imageUrl, {
          caption,
          parse_mode: "Markdown",
          reply_to_message_id: msg.message_id,
        });
      } else {
        await bot.sendMessage(chatId, caption, {
          parse_mode: "Markdown",
          reply_to_message_id: msg.message_id,
        });
      }
    } catch (err) {
      console.error(`Error looking up "${name}":`, err.message);
      bot.sendMessage(chatId, `⚠️ Error fetching *${name}*. Try again later.`, {
        parse_mode: "Markdown",
        reply_to_message_id: msg.message_id,
      });
    }
  }
});

console.log("✅ RBBot is running. Listening for [[card lookups]]...");
