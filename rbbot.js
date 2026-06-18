/**
 * Riftbound Telegram Bot — rbbot
 *
 * Setup:
 *   1. npm install node-telegram-bot-api node-fetch
 *   2. Set BOT_TOKEN as an environment variable in Railway.
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
const RIFTCODEX_BASE = "https://api.riftcodex.com";

// ─── Bot Setup ────────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── Card Lookup ──────────────────────────────────────────────────────────────
async function lookupCard(cardName) {
  const name = cardName.trim();

  // Try exact match first
  try {
    const exactUrl = `${RIFTCODEX_BASE}/cards/name?exact=${encodeURIComponent(name)}`;
    const res = await fetch(exactUrl);
    const json = await res.json();
    const cards = json.data ?? json;
    if (Array.isArray(cards) && cards.length > 0) return cards[0];
  } catch (_) {}

  // Fall back to fuzzy match
  try {
    const fuzzyUrl = `${RIFTCODEX_BASE}/cards/name?fuzzy=${encodeURIComponent(name)}`;
    const res = await fetch(fuzzyUrl);
    const json = await res.json();
    const cards = json.data ?? json;
    if (Array.isArray(cards) && cards.length > 0) return cards[0];
  } catch (_) {}

  return null;
}

// ─── Build Caption ────────────────────────────────────────────────────────────
function buildCaption(card) {
  const name = card.name ?? "Unknown";
  const type = card.classification?.type ?? "";
  const supertype = card.classification?.supertype ?? "";
  const rarity = card.classification?.rarity ?? "";
  const domain = (card.classification?.domain ?? []).join(", ");
  const energy = card.attributes?.energy;
  const might = card.attributes?.might;
  const power = card.attributes?.power;
  const set = card.set?.label ?? card.set?.set_id ?? "";
  const plainText = card.text?.plain ?? "";
  const flavour = card.text?.flavour ?? "";

  const typeLine = [supertype, type].filter(Boolean).join(" ");
  const stats = [
    energy != null ? `⚡ ${energy}` : null,
    might != null ? `⚔️ ${might}` : null,
    power != null ? `🛡️ ${power}` : null,
  ].filter(Boolean).join("  ");

  let caption = `*${name}*`;
  if (typeLine) caption += `\n_${typeLine}_`;
  if (rarity || domain) caption += `\n${[rarity, domain].filter(Boolean).join(" · ")}`;
  if (stats) caption += `\n${stats}`;
  if (set) caption += `\n📦 ${set}`;
  if (plainText) caption += `\n\n${plainText.slice(0, 600)}`;
  if (flavour) caption += `\n\n_${flavour.slice(0, 150)}_`;

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
        { parse_mode: "Markdown", reply_to_message_id: msg.message_id }
      );
    }
    return;
  }

  // Cap at 5 cards per message
  for (const name of cardNames.slice(0, 5)) {
    try {
      const card = await lookupCard(name);

      if (!card) {
        await bot.sendMessage(chatId, `❌ Card not found: *${name}*\nCheck the spelling and try again.`, {
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
      await bot.sendMessage(chatId, `⚠️ Error fetching *${name}*. Try again later.`, {
        parse_mode: "Markdown",
        reply_to_message_id: msg.message_id,
      });
    }
  }
});

console.log("✅ RBBot is running. Listening for [[card lookups]]...");
