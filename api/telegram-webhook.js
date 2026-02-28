require('dotenv').config({ path: '.env.local' });
const { callAI } = require('../lib/gemini');
const { rescheduleMeetingEvent, deleteMeetingEvent } = require('../lib/googleCalendar');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const fs = require('fs');
const path = require('path');

// In-memory state: which chat is awaiting a reschedule time reply
const pendingReschedule = {}; // chatId -> { fingerprint, eventId, clientName }

// In-memory conversation for owner AI chat
const ownerConversations = {};

const OWNER_SYSTEM_PROMPT = `You are Kai, the AI assistant for Hardik Kadd (a Creative Full-Stack Developer).
You are talking to HARDIK HIMSELF on Telegram — not a client.
Be casual, direct, and helpful. You are his personal assistant.
Keep replies SHORT — Hardik is busy. Max 3 sentences. Use emojis sparingly.`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function sendTelegram(chatId, text, replyMarkup) {
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  const data = await res.json();
  if (!data.ok) console.error('[telegram-webhook] Send failed:', data.description);
  return data;
}

async function answerCallbackQuery(callbackQueryId, text) {
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || '' })
    }
  );
}

function loadBookings() {
  const filePath = path.join(process.cwd(), 'data', 'bookings.json');
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveBookings(bookings) {
  const filePath = path.join(process.cwd(), 'data', 'bookings.json');
  fs.writeFileSync(filePath, JSON.stringify(bookings, null, 2));
}

function updateBookingStatus(fingerprint, status, newTime) {
  if (!fingerprint) return;
  const bookings = loadBookings();
  if (bookings[fingerprint]) {
    bookings[fingerprint].status = status;
    if (newTime) bookings[fingerprint].newTime = newTime;
    saveBookings(bookings);
    console.log('[telegram-webhook] Status updated:', fingerprint, '->', status);
  }
}

// Parse natural language time like "Friday 6pm" into ISO string
// Uses a simple approach with Intl — good enough for IST scheduling
function parseNaturalTime(text) {
  const tz = process.env.OWNER_TIMEZONE || 'Asia/Kolkata';
  const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);

  // Try direct Date parse first
  const direct = new Date(text);
  if (!isNaN(direct.getTime())) {
    const end = new Date(direct.getTime() + durationMins * 60000);
    return { start: direct.toISOString(), end: end.toISOString() };
  }

  // Map day names to upcoming date
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const now = new Date();
  const lowerText = text.toLowerCase();

  for (let i = 0; i < 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);
    const dayName = days[candidate.getDay()];
    if (lowerText.includes(dayName) || (i === 0 && lowerText.includes('today')) || (i === 1 && lowerText.includes('tomorrow'))) {
      // Extract hour
      const timeMatch = lowerText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const min = parseInt(timeMatch[2] || '0');
        const meridiem = timeMatch[3];
        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;
        candidate.setHours(hour, min, 0, 0);
      } else {
        candidate.setHours(10, 0, 0, 0); // default 10am
      }
      const end = new Date(candidate.getTime() + durationMins * 60000);
      return { start: candidate.toISOString(), end: end.toISOString() };
    }
  }
  return null;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // Respond 200 to Telegram immediately — required
  res.status(200).json({ ok: true });

  try {
    const update = req.body;
    const ownerChatId = process.env.TELEGRAM_CHAT_ID?.toString();

    // ─── BUTTON TAP (callback_query) ───────────────────────────────────────
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id.toString();
      if (chatId !== ownerChatId) return;

      await answerCallbackQuery(cq.id);

      const [action, fingerprint, eventId] = cq.data.split(':');
      console.log('[telegram-webhook] Button:', action, 'fp:', fingerprint, 'eid:', eventId);

      if (action === 'CANCEL') {
        // Delete the calendar event
        if (eventId) {
          try {
            await deleteMeetingEvent(eventId);
            console.log('[telegram-webhook] Calendar event deleted:', eventId);
          } catch (e) {
            console.warn('[telegram-webhook] Calendar delete failed (may not exist):', e.message);
          }
        }
        // Mark as cancelled in bookings.json
        updateBookingStatus(fingerprint, 'cancelled');
        await sendTelegram(chatId,
          `✅ Meeting cancelled.\n\nThe client will see a notification on their next visit and can rebook fresh. Their fingerprint has been flagged for reset.`
        );
        return;
      }

      if (action === 'RESCHEDULE') {
        // Save pending state and ask Hardik for new time
        pendingReschedule[chatId] = { fingerprint, eventId };
        await sendTelegram(chatId,
          `🔄 <b>Reschedule</b>\n\nWhat's the new time? Reply naturally, e.g.:\n<i>"Friday 6pm"</i> or <i>"Tomorrow 10am"</i>`
        );
        return;
      }
      return;
    }

    // ─── TEXT MESSAGE ──────────────────────────────────────────────────────
    const message = update?.message;
    if (!message || !message.text) return;

    const chatId = message.chat.id.toString();
    if (chatId !== ownerChatId) return;

    const userText = message.text;
    console.log('[telegram-webhook] Owner text:', userText);

    // ─── PENDING RESCHEDULE REPLY ──────────────────────────────────────────
    if (pendingReschedule[chatId]) {
      const { fingerprint, eventId } = pendingReschedule[chatId];
      delete pendingReschedule[chatId];

      const parsed = parseNaturalTime(userText);
      if (!parsed) {
        await sendTelegram(chatId, `Couldn't parse that time. Try something like "Friday 6pm" or "March 5 2pm".`);
        pendingReschedule[chatId] = { fingerprint, eventId }; // keep pending
        return;
      }

      let newFormattedTime = new Date(parsed.start).toLocaleString('en-IN', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
        timeZone: process.env.OWNER_TIMEZONE || 'Asia/Kolkata'
      });

      if (eventId) {
        try {
          await rescheduleMeetingEvent(eventId, parsed.start, parsed.end);
          console.log('[telegram-webhook] Rescheduled to:', parsed.start);
        } catch (e) {
          console.warn('[telegram-webhook] Calendar reschedule failed:', e.message);
          newFormattedTime = userText; // still mark it in status even if cal fails
        }
      }

      // Update booking status so client sees it on next visit
      const bookings = loadBookings();
      if (bookings[fingerprint]) {
        bookings[fingerprint].status = 'rescheduled';
        bookings[fingerprint].newTime = newFormattedTime;
        saveBookings(bookings);
      }

      await sendTelegram(chatId,
        `✅ <b>Meeting rescheduled</b> to <i>${newFormattedTime}</i>.\n\nThe client will see this notification on their next chat visit. The Google Meet link stays the same.`
      );
      return;
    }

    // ─── NORMAL OWNER CHAT (AI assistant) ─────────────────────────────────
    let bookingsContext = '';
    try {
      const bookings = loadBookings();
      const recent = Object.values(bookings).slice(-5);
      if (recent.length > 0) {
        bookingsContext = '\n\nRECENT LEADS:\n' + recent.map(b =>
          `- ${b.clientName}: "${b.projectTitle}" (${new Date(b.bookedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}) [${b.status}]`
        ).join('\n');
      }
    } catch (e) {}

    if (!ownerConversations[chatId]) ownerConversations[chatId] = [];
    ownerConversations[chatId].push({ role: 'user', content: userText });
    if (ownerConversations[chatId].length > 10) {
      ownerConversations[chatId] = ownerConversations[chatId].slice(-10);
    }

    const reply = await callAI(ownerConversations[chatId], OWNER_SYSTEM_PROMPT + bookingsContext);
    ownerConversations[chatId].push({ role: 'assistant', content: reply });

    await sendTelegram(chatId, reply);

  } catch (err) {
    console.error('[telegram-webhook] Fatal error:', err);
  }
};
