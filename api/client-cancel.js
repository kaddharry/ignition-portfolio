require('dotenv').config({ path: '.env.local' });
const { deleteMeetingEvent } = require('../lib/googleCalendar');
const fs = require('fs');
const path = require('path');

const BOOKINGS_FILE = path.join(process.cwd(), 'data', 'bookings.json');

function readBookings() {
    try { return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8')); }
    catch { return {}; }
}
function writeBookings(data) {
    fs.mkdirSync(path.dirname(BOOKINGS_FILE), { recursive: true });
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(data, null, 2));
}

// POST /api/client-cancel
// Body: { fingerprint, eventId, clientName }
module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { fingerprint, eventId, clientName } = req.body || {};
    if (!fingerprint) return res.status(400).json({ error: 'Missing fingerprint' });

    const bookings = readBookings();
    const booking = bookings[fingerprint];
    const effectiveEventId = eventId || booking?.eventId;

    // Delete calendar event
    if (effectiveEventId) {
        try {
            await deleteMeetingEvent(effectiveEventId);
            console.log('[client-cancel] Deleted event:', effectiveEventId);
        } catch (e) {
            console.warn('[client-cancel] Could not delete event:', e.message);
        }
    }

    // Update bookings.json
    if (booking) {
        bookings[fingerprint] = { ...booking, status: 'cancelled' };
        writeBookings(bookings);
    }

    // Notify Hardik on Telegram
    try {
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (chatId && token) {
            const name = clientName || booking?.clientName || 'Client';
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `❌ <b>${name}</b> cancelled their meeting.`,
                    parse_mode: 'HTML'
                })
            });
        }
    } catch(e) { console.warn('[client-cancel] Telegram notify failed:', e.message); }

    res.status(200).json({ success: true });
};
