require('dotenv').config({ path: '.env.local' });
const { createMeetingEvent, isSlotFree } = require('../lib/googleCalendar');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// POST /api/finalize-booking
// Body: { chosenTime, clientName, clientContact, projectTitle, projectDesc, budgetTier }
// Accepts full booking data from client localStorage — no server-side file read needed.
module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
        chosenTime,
        clientName,
        clientContact,
        projectTitle,
        projectDesc,
        budgetTier
    } = req.body || {};

    if (!chosenTime) return res.status(400).json({ error: 'Missing chosenTime' });

    const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);
    const eventStart = new Date(chosenTime);
    const eventEnd   = new Date(eventStart.getTime() + durationMins * 60 * 1000);

    if (isNaN(eventStart.getTime())) {
        return res.status(400).json({ error: 'invalid_time', status: 'error' });
    }

    // Final clash check before creating the event
    const free = await isSlotFree(eventStart, eventEnd);
    if (!free) {
        await sendTelegram(
            `⚠️ <b>CLASH ON FINALIZE</b>\n${clientName || 'Client'}'s soft booking couldn't be confirmed — slot was taken.\nContact: ${clientContact || 'N/A'}`
        );
        return res.status(409).json({
            status: 'clash',
            message: "That slot just got taken! Open the chat to pick a new time."
        });
    }

    // Create calendar event
    let meetLink = '', eventId = '';
    try {
        const result = await createMeetingEvent(
            eventStart.toISOString(),
            eventEnd.toISOString(),
            clientName || 'Client',
            '',
            projectTitle || 'Discovery Call'
        );
        meetLink = result.meetLink || '';
        eventId  = result.eventId  || '';
    } catch (e) {
        console.error('[finalize-booking] Calendar error:', e.message);
        return res.status(500).json({ error: e.message });
    }

    // Format IST label for Telegram
    const istLabel = eventStart.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'
    }) + ' IST';

    // Notify Hardik — MESSAGE 2 (soft booking confirmed)
    await sendTelegram(
        `✅ <b>SOFT BOOKING CONFIRMED</b>\n\n` +
        `👤 <b>${clientName || 'Client'}</b>\n` +
        `📱 ${clientContact || 'N/A'}\n\n` +
        `📋 ${projectTitle || 'Discovery Call'}\n` +
        `🗓 <b>${istLabel}</b>\n` +
        `🔗 ${meetLink}`
    );

    return res.status(200).json({ status: 'confirmed', meetLink, eventId, istLabel });
};

async function sendTelegram(text) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
        });
    } catch(e) { console.warn('[finalize-booking] Telegram failed:', e.message); }
}
