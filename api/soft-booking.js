require('dotenv').config({ path: '.env.local' });
const { isSlotFree, getFreeSlots } = require('../lib/googleCalendar');
const { isTimeInWindow, isWeekday } = require('../lib/timeUtils');

// ─── Stateless validation-only API ─────────────────────────────────────────────
// Vercel's serverless filesystem is read-only — no file writes.
// All soft-booking state is persisted in the client's localStorage.
// This API does validation + calendar clash checks only.

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action } = req.query;

    // ─── SAVE — validate + clash check, no file write ────────────────────────
    if (action === 'save') {
        const { chosenTime } = req.body || {};
        if (!chosenTime) return res.status(400).json({ error: 'Missing chosenTime' });

        const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);
        const eventStart = new Date(chosenTime);
        const eventEnd   = new Date(eventStart.getTime() + durationMins * 60 * 1000);

        if (isNaN(eventStart.getTime())) {
            return res.status(400).json({ error: 'invalid_slot', message: "Couldn't parse that time." });
        }

        // STEP 1: Time window
        if (!isTimeInWindow(eventStart)) {
            return res.status(400).json({
                error: 'outside_hours',
                message: "That time is outside available hours. Hardik is free 5:30–9:30 PM IST only."
            });
        }

        // STEP 2: Weekday
        if (!isWeekday(eventStart)) {
            return res.status(400).json({
                error: 'weekend',
                message: "Hardik isn't available on weekends. Pick a weekday (Mon–Fri)."
            });
        }

        // STEP 3: 1 hour notice
        const minimumTime = new Date(Date.now() + 60 * 60 * 1000);
        if (eventStart < minimumTime) {
            return res.status(400).json({
                error: 'too_soon',
                message: "Need at least 1 hour notice. Pick a later time."
            });
        }

        // STEP 4: Calendar clash
        const calFree = await isSlotFree(eventStart, eventEnd);
        if (!calFree) {
            let slots = [];
            try { slots = await getFreeSlots(); } catch(e) {}
            return res.status(409).json({
                error: 'slot_taken',
                message: "That slot is already taken. Pick a different time.",
                slots
            });
        }

        return res.status(200).json({ saved: true });
    }

    // ─── UPDATE — validate new time + clash check, no file write ─────────────
    if (action === 'update') {
        const { newTime, currentCount = 0 } = req.body || {};
        if (!newTime) return res.status(400).json({ error: 'Missing newTime' });

        const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);
        const eventStart = new Date(newTime);
        const eventEnd   = new Date(eventStart.getTime() + durationMins * 60 * 1000);

        if (isNaN(eventStart.getTime())) {
            return res.status(400).json({ error: 'invalid_slot', message: "Couldn't parse that time." });
        }

        // STEP 1: Time window
        if (!isTimeInWindow(eventStart)) {
            return res.status(400).json({
                error: 'outside_hours',
                message: "That time is outside available hours. Hardik is free 5:30–9:30 PM IST only."
            });
        }

        // STEP 2: Weekday
        if (!isWeekday(eventStart)) {
            return res.status(400).json({
                error: 'weekend',
                message: "Hardik isn't available on weekends. Pick a weekday (Mon–Fri)."
            });
        }

        // STEP 3: 1 hour notice
        const minimumTime = new Date(Date.now() + 60 * 60 * 1000);
        if (eventStart < minimumTime) {
            return res.status(400).json({
                error: 'too_soon',
                message: "Need at least 1 hour notice. Pick a later time."
            });
        }

        // STEP 4: Calendar clash
        const calFree = await isSlotFree(eventStart, eventEnd);
        if (!calFree) {
            return res.status(409).json({
                error: 'slot_taken',
                message: "That slot is already taken. Pick a different time."
            });
        }

        const newCount = Number(currentCount) + 1;
        return res.status(200).json({
            updated: true,
            rescheduleCount: newCount,
            remaining: 3 - newCount
        });
    }

    // ─── CANCEL — no-op on server side (state lives in localStorage) ─────────
    if (action === 'cancel') {
        return res.status(200).json({ cancelled: true });
    }

    // ─── GET — state lives in localStorage, server has nothing ───────────────
    if (action === 'get') {
        // Stateless server — client should restore from localStorage directly
        return res.status(200).json({ status: 'none' });
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=save|update|cancel|get' });
};

// Stub exports for compatibility (book-meeting.js imports softClash)
module.exports.softClash         = () => false; // no server-side soft state
module.exports.readSoftBookings  = () => ({});
module.exports.writeSoftBookings = () => {};
