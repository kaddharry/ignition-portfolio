require('dotenv').config({ path: '.env.local' });
const { rescheduleMeetingEvent, createMeetingEvent, deleteMeetingEvent } = require('../lib/googleCalendar');
const fs = require('fs');
const path = require('path');

const BOOKINGS_FILE = path.join(process.cwd(), 'data', 'bookings.json');

function readBookings() {
    try {
        return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
    } catch { return {}; }
}
function writeBookings(data) {
    fs.mkdirSync(path.dirname(BOOKINGS_FILE), { recursive: true });
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(data, null, 2));
}

// POST /api/client-reschedule
// Body: { fingerprint, newSlotISO, eventId }
// Deletes old event, creates new one with same details, updates bookings.json, notifies Hardik
module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { fingerprint, newSlotISO, eventId } = req.body || {};
    if (!fingerprint || !newSlotISO) return res.status(400).json({ error: 'Missing fingerprint or newSlotISO' });

    const bookings = readBookings();
    const booking = bookings[fingerprint];
    if (!booking) return res.status(404).json({ error: 'Booking not found for this fingerprint' });

    const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);
    const newStart = new Date(newSlotISO);
    const newEnd = new Date(newStart.getTime() + durationMins * 60 * 1000);

    try {
        // Try to patch existing event first
        const effectiveEventId = eventId || booking.eventId;
        let meetLink = booking.meetLink || '';
        let newEventId = effectiveEventId;

        if (effectiveEventId) {
            try {
                const result = await rescheduleMeetingEvent(effectiveEventId, newStart.toISOString(), newEnd.toISOString());
                meetLink = result.meetLink || meetLink;
                newEventId = result.eventId || newEventId;
            } catch (patchErr) {
                console.warn('[client-reschedule] Patch failed, deleting + recreating:', patchErr.message);
                // Delete and recreate
                try { await deleteMeetingEvent(effectiveEventId); } catch(e) {}
                const created = await createMeetingEvent(
                    newStart.toISOString(), newEnd.toISOString(),
                    booking.clientName || 'Client', '', booking.projectTitle || 'Discovery Call'
                );
                meetLink = created.meetLink;
                newEventId = created.eventId;
            }
        } else {
            // No eventId — create fresh
            const created = await createMeetingEvent(
                newStart.toISOString(), newEnd.toISOString(),
                booking.clientName || 'Client', '', booking.projectTitle || 'Discovery Call'
            );
            meetLink = created.meetLink;
            newEventId = created.eventId;
        }

        // Update bookings.json
        bookings[fingerprint] = {
            ...booking,
            eventId: newEventId,
            meetLink,
            status: 'rescheduled',
            newTime: newStart.toISOString(),
            bookedAt: booking.bookedAt
        };
        writeBookings(bookings);

        const istLabel = newStart.toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'
        });

        // Notify Hardik on Telegram
        try {
            const chatId = process.env.TELEGRAM_CHAT_ID;
            const token = process.env.TELEGRAM_BOT_TOKEN;
            if (chatId && token) {
                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `📅 <b>${booking.clientName || 'Client'}</b> rescheduled their meeting to <b>${istLabel} IST</b>\n🔗 ${meetLink}`,
                        parse_mode: 'HTML'
                    })
                });
            }
        } catch(e) { console.warn('[client-reschedule] Telegram notify failed:', e.message); }

        res.status(200).json({ success: true, meetLink, eventId: newEventId, istLabel });

    } catch (err) {
        console.error('[client-reschedule] Error:', err.message);
        res.status(500).json({ error: err.message, message: "Couldn't update the calendar. Hardik has been notified." });
    }
};
