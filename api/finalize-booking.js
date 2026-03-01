require('dotenv').config({ path: '.env.local' });
const { createMeetingEvent, isSlotFree } = require('../lib/googleCalendar');
const { readSoftBookings, writeSoftBookings } = require('./soft-booking');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// POST /api/finalize-booking
// Body: { sessionId }
// Called at 30-min timeout OR when rescheduleCount reaches 3
module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const soft = readSoftBookings();
    const entry = soft[sessionId];

    if (!entry) return res.status(400).json({ error: 'Soft booking not found', status: 'not_found' });
    if (entry.status !== 'soft') return res.status(400).json({ error: 'Already processed', status: entry.status });

    const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);
    const eventStart = new Date(entry.chosenTime);
    const eventEnd   = new Date(eventStart.getTime() + durationMins * 60 * 1000);

    // Final clash check
    const free = await isSlotFree(eventStart, eventEnd);
    if (!free) {
        soft[sessionId].status = 'clash_on_finalize';
        writeSoftBookings(soft);

        // Notify Hardik
        await sendTelegram(`⚠️ <b>CLASH ON FINALIZE</b>\n${entry.clientName}'s soft booking couldn't be confirmed — slot was taken by another event.\nContact: ${entry.clientContact}`);

        return res.status(409).json({ status: 'clash', message: 'That slot just got taken! Open the chat to pick a new time.' });
    }

    // Create calendar event
    let meetLink = '', eventId = '';
    try {
        const result = await createMeetingEvent(
            eventStart.toISOString(),
            eventEnd.toISOString(),
            entry.clientName || 'Client',
            '',
            entry.projectTitle || 'Discovery Call'
        );
        meetLink = result.meetLink || '';
        eventId  = result.eventId  || '';
    } catch (e) {
        console.error('[finalize-booking] Calendar error:', e.message);
        return res.status(500).json({ error: e.message });
    }

    // Update soft-bookings.json
    soft[sessionId] = {
        ...entry,
        status: 'confirmed',
        eventId,
        meetLink,
        confirmedAt: new Date().toISOString()
    };
    writeSoftBookings(soft);

    // Format IST label
    const istLabel = eventStart.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'
    });

    // Notify Hardik — MESSAGE 2
    await sendTelegram(
        `✅ <b>SOFT BOOKING CONFIRMED</b>\n\n` +
        `👤 <b>${entry.clientName}</b>\n` +
        `📱 ${entry.clientContact}\n\n` +
        `📋 ${entry.projectTitle}\n` +
        `🗓 <b>${istLabel} IST</b>\n` +
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
