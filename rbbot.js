/**
 * Riftbound Telegram Bot â€” rbbot
 *
 * Setup:
 *   1. npm install node-telegram-bot-api node-fetch
 *   2. Set BOT_TOKEN as an environment variable in Railway.
 *   3. node rbbot.js
 *
 * Usage in Telegram group:
 *   [[Irelia, Fervent]]
 *   [[Master Yi]] [[Jinx]]   â† multiple cards in one message
 *   /rbbot [[Irelia, Fervent]]
 */

const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const RIFTCODEX_BASE = "https://api.riftcodex.com/api";

// â”€â”€â”€ Bot Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// â”€â”€â”€ Card Lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function lookupCard(cardName) {
  const name = cardName.trim();

  // Try exact match first
  try {
    const url = `${RIFTCODEX_BASE}/cards/name?exact=${encodeURIComponent(name)}`;
    console.log(`[exact] Fetching: ${url}`);
    const res = await fetch(url);
    const json = await res.json();
    console.log(`[exact] Response:`, JSON.stringify(json).slice(0, 300));
    const cards = json.items ?? json.data ?? json;
    if (Array.isArray(cards) && cards.length > 0) return cards[0];
    if (json.name) return json; // single card returned directly
  } catch (err) {
    console.error("[exact] Error:", err.message);
  }

  // Fall back to fuzzy match
  try {
    const url = `${RIFTCODEX_BASE}/cards/name?fuzzy=${encodeURIComponent(name)}`;
    console.log(`[fuzzy] Fetching: ${url}`);
    const res = await fetch(url);
    const json = await res.json();
    console.log(`[fuzzy] Response:`, JSON.stringify(json).slice(0, 300));
    const cards = json.items ?? json.data ?? json;
    if (Array.isArray(cards) && cards.length > 0) return cards[0];
    if (json.name) return json;
  } catch (err) {
    console.error("[fuzzy] Error:", err.message);
  }

  return null;
}

// â”€â”€â”€ Build Caption â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildCaption(card) {
  const name = card.name ?? "Unknown";
  const type = card.classification?.type ?? card.type ?? "";
  const supertype = card.classification?.supertype ?? card.supertype ?? "";
  const rarity = card.classification?.rarity ?? card.rarity ?? "";
  const domain = (card.classification?.domain ?? card.domain ?? []).join(", ");
  const energy = card.attributes?.energy ?? card.energy;
  const might = card.attributes?.might ?? card.might;
  const power = card.attributes?.power ?? card.power;
  const set = card.set?.label ?? card.set?.set_id ?? card.set ?? "";
  const plainText = card.text?.plain ?? card.text ?? "";
  const flavour = card.text?.flavour ?? card.flavour_text ?? "";

  const typeLine = [supertype, type].filter(Boolean).join(" ");
  const stats = [
    energy != null ? `âš¡ ${energy}` : null,
    might != null ? `âš”ï¸ ${might}` : null,
    power != null ? `ðŸ›¡ï¸ ${power}` : null,
  ].filter(Boolean).join("  ");

  let caption = `*${name}*`;
  if (typeLine) caption += `\n_${typeLine}_`;
  if (rarity || domain) caption += `\n${[rarity, domain].filter(Boolean).join(" Â· ")}`;
  if (stats) caption += `\n${stats}`;
  if (set) caption += `\nðŸ“¦ ${set}`;
  if (plainText) caption += `\n\n${plainText.slice(0, 600)}`;
  if (flavour) caption += `\n\n_${flavour.slice(0, 150)}_`;

  return caption;
}

// â”€â”€â”€ Extract [[Card Names]] from message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function extractCardNames(text) {
  const matches = [...text.matchAll(/\[\[(.+?)\]\]/g)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

// â”€â”€â”€ Message Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  for (const name of cardNames.slice(0, 5)) {
    try {
      const card = await lookupCard(name);

      if (!card) {
        await bot.sendMessage(chatId, `âŒ Card not found: *${name}*\nCheck the spelling and try again.`, {
          parse_mode: "Markdown",
          reply_to_message_id: msg.message_id,
        });
        continue;
      }

      const imageUrl = card.media?.image_url ?? card.image_url ?? card.image;
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
      await bot.sendMessage(chatId, `âš ï¸ Error fetching *${name}*. Try again later.`, {
        parse_mode: "Markdown",
        reply_to_message_id: msg.message_id,
      });
    }
  }
});

console.log("âœ… RBBot is running. Listening for [[card lookups]]...");
