require('dotenv').config({ path: '.env.local' });
const { callAI } = require('../lib/gemini');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const fs = require('fs');
const path = require('path');

// In-memory conversation history per chat (resets on server restart)
const ownerConversations = {};

const OWNER_SYSTEM_PROMPT = `You are Kai, the AI assistant for Hardik Kadd (a Creative Full-Stack Developer).
You are now talking to HARDIK HIMSELF on Telegram — not a client.
Be casual, direct, and helpful. You are his personal assistant.

You have access to context about recent client leads that were sent to him.
When Hardik asks about clients or meetings, answer from the context provided.

You can help Hardik with:
- Summarizing recent leads
- Telling him about specific clients by name
- Reminding him of meeting times
- Helping him draft replies to clients
- Telling him if he should accept or decline based on budget tier

Recent leads context will be injected into each message automatically.

Keep replies SHORT — Hardik is busy. Max 3 sentences.
Use casual language. You can use emojis sparingly.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  
  // Always respond 200 to Telegram immediately (required by Telegram)
  res.status(200).json({ ok: true });
  
  try {
    const update = req.body;
    const message = update?.message;
    if (!message || !message.text) return;
    
    const chatId = message.chat.id.toString();
    const ownerChatId = process.env.TELEGRAM_CHAT_ID?.toString();
    
    // SECURITY: Only respond to the owner's chat
    if (chatId !== ownerChatId) {
      console.log('[telegram-webhook] Ignoring message from non-owner chat:', chatId);
      return;
    }
    
    const userText = message.text;
    console.log('[telegram-webhook] Owner message:', userText);
    
    // Load recent bookings for context
    let bookingsContext = '';
    try {
      const filePath = path.join(process.cwd(), 'data', 'bookings.json');
      if (fs.existsSync(filePath)) {
        const bookings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const recent = Object.values(bookings).slice(-5);
        if (recent.length > 0) {
          bookingsContext = '\n\nRECENT LEADS:\n' + recent.map(b =>
            `- ${b.clientName}: "${b.projectTitle}" (${new Date(b.bookedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })})`
          ).join('\n');
        }
      }
    } catch (e) {
      console.warn('[telegram-webhook] Could not load bookings:', e.message);
    }
    
    // Build and trim conversation history
    if (!ownerConversations[chatId]) ownerConversations[chatId] = [];
    ownerConversations[chatId].push({ role: 'user', content: userText });
    if (ownerConversations[chatId].length > 10) {
      ownerConversations[chatId] = ownerConversations[chatId].slice(-10);
    }
    
    const systemWithContext = OWNER_SYSTEM_PROMPT + bookingsContext;
    const reply = await callAI(ownerConversations[chatId], systemWithContext);
    
    ownerConversations[chatId].push({ role: 'assistant', content: reply });
    
    console.log('[telegram-webhook] Kai reply:', reply);
    
    // Send reply back to Hardik on Telegram
    const telegramRes = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: reply,
          parse_mode: 'HTML'
        })
      }
    );
    const telegramData = await telegramRes.json();
    if (!telegramData.ok) {
      console.error('[telegram-webhook] Send failed:', telegramData.description);
    }
    
  } catch (err) {
    console.error('[telegram-webhook] Fatal error:', err);
  }
};
