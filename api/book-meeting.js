require('dotenv').config({ path: '.env.local' });
const { createMeetingEvent, isSlotFree, getFreeSlots } = require('../lib/googleCalendar');
const { parseNaturalSlot, isTimeInWindow, isWeekday } = require('../lib/timeUtils');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { slot, clientName, clientEmail, clientContact, projectTitle } = req.body;
        console.log('[book-meeting] Request:', { slot, clientName, projectTitle });

        // ── STEP 1: Parse the slot ────────────────────────────────────────────
        const eventStart = parseNaturalSlot(slot);

        if (!eventStart || isNaN(eventStart.getTime())) {
            console.warn('[book-meeting] Could not parse slot:', slot);
            let slots = [];
            try { slots = await getFreeSlots(); } catch(e) {}
            return res.status(400).json({
                error: 'invalid_slot',
                message: "That date doesn't exist or I couldn't understand it. Try something like 'Monday 7 PM' or 'March 15 6:30 PM'.",
                slots
            });
        }

        const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);
        const eventEnd = new Date(eventStart.getTime() + durationMins * 60 * 1000);

        // ── STEP 2: Check time is within 5:30–9:30 PM IST ────────────────────
        if (!isTimeInWindow(eventStart)) {
            let slots = [];
            try { slots = await getFreeSlots(); } catch(e) {}
            return res.status(400).json({
                error: 'outside_hours',
                message: "That time is outside Hardik's available window (5:30–9:30 PM IST). Pick a time in that window and try again!",
                slots
            });
        }

        // ── STEP 3: Check day is Mon–Fri ──────────────────────────────────────
        if (!isWeekday(eventStart)) {
            let slots = [];
            try { slots = await getFreeSlots(); } catch(e) {}
            return res.status(400).json({
                error: 'weekend',
                message: "Hardik is only available Monday to Friday. Pick a weekday!",
                slots
            });
        }

        // ── STEP 4: 1-hour minimum notice ────────────────────────────────────
        const minimumTime = new Date(Date.now() + 60 * 60 * 1000);
        if (eventStart < minimumTime) {
            let slots = [];
            try { slots = await getFreeSlots(); } catch(e) {}
            return res.status(400).json({
                error: 'too_soon',
                message: 'Need at least 1 hour notice. Pick a later time!',
                slots
            });
        }

        // ── STEP 5: Calendar clash check ─────────────────────────────────────
        const free = await isSlotFree(eventStart, eventEnd);
        if (!free) {
            let slots = [];
            try { slots = await getFreeSlots(); } catch(e) {}
            return res.status(409).json({
                error: 'slot_taken',
                message: "That slot is already taken. Pick one of the open times below!",
                slots
            });
        }

        // ── STEP 6: Book it! ─────────────────────────────────────────────────
        const result = await createMeetingEvent(
            eventStart.toISOString(),
            eventEnd.toISOString(),
            clientName || 'Client',
            clientEmail || '',
            projectTitle || 'Discovery Call'
        );

        console.log('[book-meeting] Created:', result.meetLink);
        res.status(200).json({
            meetLink: result.meetLink || '',
            eventId:  result.eventId  || '',
            htmlLink: result.htmlLink || '',
            startTime: eventStart.toISOString()
        });

    } catch (err) {
        console.error('[book-meeting] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};
