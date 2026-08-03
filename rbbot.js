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

const RIFTCODEX_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; RBBot/1.0; Telegram card lookup bot)",
  "Accept": "application/json",
};


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
    const res = await fetch(url, { headers: RIFTCODEX_HEADERS });
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
    const res = await fetch(url, { headers: RIFTCODEX_HEADERS });
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
    const res = await fetch(url, { headers: RIFTCODEX_HEADERS });
    const cards = json.items ?? json.data ?? (Array.isArray(json) ? json : null);
    if (cards && cards.length > 0) return cards[0];
  } catch (err) {
    console.error("[search] Error:", err.message);
  }

  return null;
}

// ─── Currency Conversion (Frankfurter, EUR → USD/SGD) ────────────────────────
let exchangeRatesCache = { rates: null, fetchedAt: 0 };

async function getExchangeRates() {
  const ONE_HOUR = 60 * 60 * 1000;
  if (exchangeRatesCache.rates && Date.now() - exchangeRatesCache.fetchedAt < ONE_HOUR) {
    return exchangeRatesCache.rates;
  }

  try {
    const url = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,SGD";
    console.log(`[fx] GET ${url}`);
    const res = await fetch(url);
    const json = await res.json();
    console.log(`[fx] Response: ${JSON.stringify(json).slice(0, 300)}`);
    if (json.rates) {
      exchangeRatesCache = { rates: json.rates, fetchedAt: Date.now() };
      return json.rates;
    }
  } catch (err) {
    console.error("[fx] Error:", err.message);
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

  try {
    const query = encodeURIComponent(cardName.trim());
    const url = `https://${RAPIDAPI_HOST}/cards?search=${query}`;
    console.log(`[price] GET ${url}`);
    const res = await fetch(url, { headers });
    const json = await res.json();
    console.log(`[price] Response: ${JSON.stringify(json).slice(0, 400)}`);

    // Response can be a single object under "data", or a list — handle both
    const payload = json.data ?? json;
    const cards = Array.isArray(payload) ? payload : [payload];
    if (!cards || cards.length === 0 || !cards[0]) return null;

    const baseName = cardName.split(/[-,]/)[0].trim().toLowerCase();
    const match = cards.find((c) => c?.name?.toLowerCase().includes(baseName)) ?? cards[0];

    return match?.prices ?? null;
  } catch (err) {
    console.error(`[price] Error:`, err.message);
    return null;
  }
}

// ─── Format a number as MarkdownV2-safe currency string ──────────────────────
function fmtMoney(amount, symbol) {
  return esc(`${symbol}${amount.toFixed(2)}`);
}

// ─── Format Price Lines ───────────────────────────────────────────────────────
function formatPrices(prices, rates) {
  if (!prices) return null;

  const lines = [];
  const cm = prices?.cardmarket;

  if (cm) {
    const low = cm.lowest_near_mint;
    const avg7d = cm["7d_average"];
    const avg30d = cm["30d_average"];

    if (low != null) {
      let line = `🌍 Cardmarket: ${fmtMoney(low, "€")} \\(low\\)`;
      if (rates?.USD) line += ` · ${fmtMoney(low * rates.USD, "$")}`;
      if (rates?.SGD) line += ` · ${fmtMoney(low * rates.SGD, "S$")}`;
      lines.push(line);
    }
    if (avg7d != null) {
      lines.push(`📈 7d avg: ${fmtMoney(avg7d, "€")}`);
    }
    if (avg30d != null) {
      lines.push(`📊 30d avg: ${fmtMoney(avg30d, "€")}`);
    }
  }

  const tcg = prices?.tcgplayer;
  if (tcg) {
    const tcgMarket = tcg.market;
    const tcgLow = tcg.low;
    if (tcgMarket != null || tcgLow != null) {
      let line = "💵 TCGPlayer:";
      if (tcgMarket != null) line += ` ${fmtMoney(tcgMarket, "$")}`;
      if (tcgLow != null) line += ` \\(low ${fmtMoney(tcgLow, "$")}\\)`;
      lines.push(line);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// ─── Build Caption (MarkdownV2) ───────────────────────────────────────────────
function buildCaption(card, prices, rates, errata) {
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

  const priceLines = formatPrices(prices, rates);
  if (priceLines) caption += `\n\n${priceLines}`;

  // Errata section — shown prominently at the bottom
  if (errata) {
    caption += `\n\n⚠️ *ERRATA*`;
    caption += `\n~${esc(errata.old.slice(0, 300))}~`;
    caption += `\n\n✅ *Corrected Text:*`;
    caption += `\n*${esc(errata.new.slice(0, 300))}*`;
  }

  return caption;
}

// ─── Errata Data (sourced from riftwatcher.com/rules/errata/) ────────────────
// Refreshed manually when Riot publishes new errata
const ERRATA_DATA = {
  "ava achiever": { old: "When I attack, you may pay [C] to play a card with [Hidden] from your hand here, ignoring its cost.", new: "When I attack, you may pay [C] to play a card with [Hidden] from your hand, ignoring its cost. If it's a unit, play it here." },
  "baited hook": { old: "[1][C], [E]: Kill a friendly unit. Look at the top 5 cards of your Main Deck. You may play a unit from among them that has the same name as the killed unit, ignoring its cost. Recycle the rest.", new: "[1][C], [E]: Kill a friendly unit. Look at the top 5 cards of your Main Deck. You may banish a unit from among them that has the same name as the killed unit, then play it, ignoring its cost. Recycle the rest." },
  "blind fury": { old: "[Action] (Play on your turn or in showdowns.)\nEach opponent reveals the top card of their Main Deck. Choose one and play it, ignoring its cost.", new: "[Action] (Play on your turn or in showdowns.)\nEach opponent reveals the top card of their Main Deck. Choose one and banish it, then play it, ignoring its cost." },
  "clockwork keeper": { old: "As you play me, you may pay [C] as an additional cost. If you do, draw 1.", new: "You may pay [C] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, draw 1." },
  "convergent mutation": { old: "Choose a friendly unit. Increase its Might until it equals the Might of the strongest enemy unit here.", new: "Choose a friendly unit. This turn, increase its Might until it equals the Might of the strongest enemy unit here." },
  "dark child - starter": { old: "At the end of your turn, ready 2 runes.", new: "At the end of your turn, ready up to 2 runes." },
  "dazzling aurora": { old: "At the end of your turn, reveal cards from the top of your Main Deck until you reveal a unit. Play it, ignoring its cost. Recycle the rest.", new: "At the end of your turn, reveal cards from the top of your Main Deck until you reveal a unit and banish it. Play it, ignoring its cost. Recycle the rest." },
  "disintegrate": { old: "[Action] (Play on your turn or in showdowns.)\nDeal 3 to a unit at a battlefield. If this kills it, draw 1.", new: "Action (Play on your turn or in showdowns.)\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1." },
  "dragon's rage": { old: "Move an enemy unit. Then choose another enemy unit at its destination. They deal damage equal to their Mights to each other.", new: "Move an enemy unit. Then do this: Choose another enemy unit at its destination. They deal damage equal to their Mights to each other." },
  "dune drake": { old: "When I attack, give me +2 [M] if there is a ready enemy unit here.", new: "When I attack, give me +2 [M] this turn if there is a ready enemy unit here." },
  "highlander": { old: "Choose a friendly unit. The next time it dies this turn, recall it instead.", new: "Choose a friendly unit. The next time it would die this turn, recall it instead." },
  "karma, channeler": { old: "When you recycle one or more cards, draw 1. (Limit once per turn.)", new: "When you recycle one or more cards, do this: draw 1. (Limit once per turn.)" },
  "kinkou monk": { old: "When you play me, buff two other friendly units. (Each one that doesn't have a buff gets a +1 [M] buff.)", new: "When you play me, buff up to two other friendly units. (Each one that doesn't have a buff gets a +1 [M] buff.)" },
  "nocturne, horrifying": { old: "When you look at cards from the top of your deck (and don't draw them), you may banish me from among them and play me.", new: "As you look at or reveal me from the top of your deck, you may banish me, then play me." },
  "pack of wonders": { old: "[E]: Return another friendly gear, unit, or [Hidden] card to its owner's hand.", new: "[E]: Return another friendly gear, unit, or facedown card to its owner's hand." },
  "portal rescue": { old: "Banish a friendly unit, then play it to base, ignoring its cost.", new: "Banish a friendly unit, then its owner plays it to their base, ignoring its cost." },
  "promising future": { old: "Each player looks at the top 5 cards of their Main Deck, chooses one, then recycles the rest.", new: "Each player looks at the top 5 cards of their Main Deck, banishes one of them, then recycles the rest." },
  "ravenborn tome": { old: "[E]: The next spell you play deals 1 Bonus Damage.", new: "[E]: The next spell you play this turn deals 1 Bonus Damage." },
  "salvage": { old: "You may kill a gear. Draw 1.", new: "You may kill up to one gear. Draw 1." },
  "sigil of the storm": { old: "When you conquer here, you must recycle one of your runes. (This doesn't choose anything.)", new: "When you conquer here, you must recycle one of your runes. (This doesn't choose anything.) [unchanged — functional errata only]" },
  "sona, harmonious": { old: "While I'm at a battlefield, ready 4 friendly runes at the end of your turn.", new: "At the end of your turn, if I'm at a battlefield, ready up to 4 friendly runes." },
  "targon's peak": { old: "When you conquer here, ready 2 runes at the end of this turn.", new: "When you conquer here, ready up to 2 runes at the end of this turn." },
  "teemo, strategist": { old: "When I defend or I'm played from [Hidden], reveal the top 5 cards of your Main Deck. You may play a unit from among them, ignoring its cost. Recycle the rest.", new: "When I defend, choose an enemy unit here and reveal the top 5 cards of your Main Deck. You may banish a unit from among them, then play it here, ignoring its cost. Recycle the rest." },
  "the boss": { old: "When a buffed unit you control would die, you may pay [C] and exhaust me to spend its buff and recall it exhausted instead.", new: "If a buffed unit you control would die, you may pay [C], exhaust me, and spend its buff to heal it, exhaust it, and recall it instead." },
  "the dreaming tree": { old: "The first time you choose a friendly unit with a spell here each turn, draw 1.", new: "When a player chooses a friendly unit here with a spell for the first time each turn, they draw 1." },
  "the syren": { old: "[1], [E]: Move a friendly unit at a battlefield to your base.", new: "[1], [E]: Move a friendly unit at a battlefield to its base." },
  "tideturner": { old: "When you play me, you may choose a friendly unit. Move me to its battlefield.", new: "When you play me, you may choose a unit you control at another battlefield. Move me there." },
  "unforgiven": { old: "[2], [E]: Move a friendly unit to or from your base.", new: "[2], [E]: Move a friendly unit to or from its base." },
  "unlicensed armory": { old: "Discard 1, [E]: Choose a friendly unit. The next time it dies this turn, you may pay [C] to recall it exhausted instead.", new: "Discard 1, [E]: Choose a friendly unit. The next time it would die this turn, you may pay [C] to heal it, exhaust it, and recall it instead." },
  "void gate": { old: "Spells and abilities affecting units here each deal 1 Bonus Damage.", new: "Spells and abilities deal 1 Bonus Damage to units here." },
  "zhonya's hourglass": { old: "The next time a friendly unit would die, kill this instead. Recall that unit.", new: "If a friendly unit would die, kill this instead. Heal that unit and recall it." },
  "falling star": { old: "Do this twice:\nDeal 3 to a unit. (You can choose different units.)", new: "Deal 3 to a unit.\nDeal 3 to a unit." },
  "icathian rain": { old: "Do this 6 times:\nDeal 2 to a unit. (You can choose different units.)", new: "Deal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit." },
  "reinforce": { old: "Look at the top 5 cards of your Main Deck. You may play a unit from among them. Its Energy cost is reduced by [5]. Then recycle the rest.", new: "Look at the top 5 cards of your Main Deck. You may banish a unit from among them, then play it, reducing its cost by [5]. Recycle the rest." },
  "arise!": { old: "Play a 2 [M] Sand Soldier unit token for each Equipment you control. Then ready two of them.", new: "Play a 2 [M] Sand Soldier unit token for each Equipment you control. Then do this: Ready up to two of them." },
  "blood rush": { old: "[Repeat] [1] (You may pay the additional cost to repeat this spell's effect.)\nGive a friendly unit +2 [M] this turn.", new: "[Repeat] [1] (You may pay the additional cost to repeat this spell's effect.)\nGive a friendly unit +2 [M] this turn. [functional errata — see riftwatcher for full text]" },
  "deathgrip": { old: "Kill a friendly unit to give +[M] equal to its Might to another friendly unit this turn.", new: "Kill a friendly unit. If you do, give +[M] equal to its Might to another friendly unit this turn." },
  "jax, unmatched": { old: "Each Equipment in your hand has [Quick-Draw].", new: "Your Equipment everywhere have [Quick-Draw]." },
  "kato the arm": { old: "When I move to a battlefield, give a friendly unit here +2 [M] this turn.", new: "When I move to a battlefield, give another friendly unit here +2 [M] this turn." },
  "rek'sai, swarm queen": { old: "When I attack, you may reveal the top 2 cards of your Main Deck. You may play one. Then recycle the rest. If the played card is a unit, it enters ready.", new: "When I attack, you may reveal the top 2 cards of your Main Deck. You may banish one, then play it. If it is a unit, you may have it enter ready. Recycle the rest." },
  "rell, magnetic": { old: "When I attack, you may play an Equipment with Energy cost no more than [2] from your hand for free.", new: "When I attack, you may play an Equipment with Energy cost no more than [2] from your hand, ignoring its cost." },
  "tianna crownguard": { old: "While I'm at a battlefield, opponents can't score or gain Power.", new: "While I'm at a battlefield, opponents can't gain Power." },
  "void burrower": { old: "When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck. You may play one. Then recycle the rest.", new: "When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck. You may banish one, then play it. Recycle the rest." },
  "void rush": { old: "Reveal the top 2 cards of your Main Deck. You may play one of them, reducing its cost by [2]. Draw any you did not play.", new: "Reveal the top 2 cards of your Main Deck. You may banish one, then play it, reducing its cost by [2]. Draw any you didn't banish." },
  "yone, blademaster": { old: "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for [A] less, even if it's already attached.)", new: "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for [A] less, even if it's already attached.) [functional errata — see riftwatcher for full text]" },
  "guards!": { old: "Play a 2 [M] Sand Soldier unit token. You may pay [C] to ready it.", new: "Play a 2 [M] Sand Soldier unit token. Then do this: You may pay [C] to ready it." },
  "relentless pursuit": { old: "Move a friendly unit. You may attach an Equipment with the same controller to it.", new: "Move a friendly unit. You may attach up to one Equipment with the same controller to it." },
  "draven, vanquisher": { old: "When I attack or defend, you may pay [F]. If you do, give me +2 [M] this turn.", new: "When I attack or defend, you may pay [F] to give me +2 [M] this turn." },
  "emperor's dais": { old: "When you conquer here, you may pay [1] and return a unit you control here to its owner's hand. If you do, play a 2 [M] Sand Soldier unit token here.", new: "When you conquer here, you may pay [1] and return a unit you control here to its owner's hand to play a 2 [M] Sand Soldier unit token here." },
  "fizz, trickster": { old: "When you play me, you may play a spell from your trash with Energy cost no more than [3], ignoring its Energy cost. Recycle it.", new: "When you play me, you may play a spell from your trash with Energy cost no more than [3], ignoring its Energy cost. Then recycle it." },
  "death from below": { old: "Kill a unit at a battlefield. Then, if it had 3 [M] or less, you may play this from trash for [A].", new: "Kill a unit at a battlefield. Then, if it had 3 [M] or less, do this: You may play this from trash for [A]." },
  "bone skewer": { old: "When they do, [Stun] it.", new: "If they do, then do this: [Stun] it." },
  "deceiver": { old: "Play a ready Reflection unit token there. It becomes a copy of another unit there.", new: "Play a ready Reflection unit token there. Then do this: It becomes a copy of another unit there." },
  "mirror image": { old: "Play a ready Reflection unit token to your base. It becomes a copy of that unit.", new: "Play a ready Reflection unit token to your base. Then do this: It becomes a copy of that unit." },
  "rengar, trophy hunter": { old: "I can be played to a battlefield where there are enemy units (even if you don't have units there).", new: "I can [Ambush] to a battlefield where there are enemy units, even if you don't have units there." },
  "diana, lunari": { old: "When a showdown begins here, you may pay [1]. If you do, [Predict], then reveal the top card of your Main Deck. If it's a spell, you may play it here, ignoring its cost.", new: "When a showdown begins here, you may pay [1] to [Predict], then reveal the top card of your Main Deck. If it's a spell, you may play it here, ignoring its cost." },
  "stalking wolf": { old: "As an additional cost to play me, kill a friendly unit.", new: "As an additional cost to play me, kill up to one friendly unit." },
  "astral heron": { old: "When you play your first card each turn, if I'm at a battlefield, your next card costs [2][C][C] less.", new: "When you play your first card each turn, if I'm at a battlefield, the next card you play this turn costs [2][C][C] less." },
  "gangplank, naval": { old: "If a spell or ability that chooses me would stun me, give me -[M], or return me to hand, give me +3 [M] instead.", new: "If a spell or ability that chooses me would stun me, give me -[M], or return me to hand, give me +3 [M] this turn instead." },
  "resonating strike": { old: "[Reaction] (Play on your turn or in showdowns.)", new: "[Reaction] (Play any time, even before spells and abilities resolve.)" },
  "janna, savior": { old: "When you play me, choose a friendly unit here. Move it to another battlefield.", new: "When you play me, choose a friendly unit here. Move it to another battlefield. [functional errata — see riftwatcher for full text]" },
  "edge of night": { old: "When you play this from face down, attach it to a unit you control.", new: "When you play this from face down, attach it to a unit you control. [functional errata — see riftwatcher for full text]" },
};

function getErrata() {
  return ERRATA_DATA;
}



function findErrata(errata, cardName) {
  if (!errata || !cardName) return null;
  const name = cardName.toLowerCase();

  // Try exact match first
  if (errata[name]) return errata[name];

  // Try matching just the base name (before " - ")
  const baseName = name.split(" - ")[0].trim();
  const match = Object.keys(errata).find((k) =>
    k === baseName || k.startsWith(baseName)
  );
  return match ? errata[match] : null;
}


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
      const card = await lookupCard(name);

      if (!card) {
        await bot.sendMessage(chatId,
          `❌ Card not found: *${esc(name)}*\nCheck the spelling and try again`,
          { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }
        ).catch(() => {});
        continue;
      }

      const [prices, rates] = await Promise.all([
        lookupPrice(card.name),
        getExchangeRates(),
      ]);

      const cardErrata = findErrata(getErrata(), card.name);
      const imageUrl = card.media?.image_url;
      const caption = buildCaption(card, prices, rates, cardErrata);

      try {
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
      } catch (sendErr) {
        console.error(`[send_error] "${name}": ${sendErr.message}`);
        console.error(`[caption_dump] ${caption}`);
        // Fallback: send as plain text so user still gets something
        await bot.sendMessage(chatId,
          `Found: ${esc(card.name)} — but had a formatting error displaying it`,
          { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }
        ).catch(() => {});
      }
    } catch (err) {
      console.error(`Error looking up "${name}":`, err.message);
      await bot.sendMessage(chatId,
        `⚠️ Error fetching *${esc(name)}* — try again later`,
        { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }
      ).catch(() => {});
    }
  }
});

// ─── Suppress verbose polling errors (prevents crash on network blips) ────────
bot.on("polling_error", (err) => {
  console.error(`[polling_error] ${err.code}: ${err.message}`);
});


const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("RBBot is running!");
}).listen(PORT, () => {
  console.log(`✅ RBBot is running on port ${PORT}. Listening for [[card lookups]]...`);
});

// ─── Keep-alive ping (prevents Render free tier from sleeping) ────────────────
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    fetch(RENDER_URL)
      .then(() => console.log(`[keep-alive] Pinged ${RENDER_URL}`))
      .catch((err) => console.error(`[keep-alive] Ping failed: ${err.message}`));
  }, 14 * 60 * 1000); // every 14 minutes
}
