require('dotenv').config({ path: '.env.local' });
const { isSlotFree } = require('../lib/googleCalendar');
const { parseNaturalSlot, isTimeInWindow, isWeekday } = require('../lib/timeUtils');
const fs = require('fs');
const path = require('path');

const SOFT_FILE = path.join(process.cwd(), 'data', 'soft-bookings.json');

function readSoftBookings() {
    try { return JSON.parse(fs.readFileSync(SOFT_FILE, 'utf8')); }
    catch { return {}; }
}

function writeSoftBookings(data) {
    fs.mkdirSync(path.dirname(SOFT_FILE), { recursive: true });
    fs.writeFileSync(SOFT_FILE, JSON.stringify(data, null, 2));
}

// Check if a slot clashes with any ACTIVE soft booking (excludes current sessionId)
function softClash(chosenISO, durationMins, excludeSessionId) {
    const soft = readSoftBookings();
    const start = new Date(chosenISO).getTime();
    const end   = start + durationMins * 60 * 1000;

    for (const [sid, entry] of Object.entries(soft)) {
        if (sid === excludeSessionId) continue;
        if (entry.status !== 'soft') continue; // only block active soft bookings
        // Check if softBookedAt + 30min window has expired
        const windowEnd = new Date(entry.softBookedAt).getTime() + 30 * 60 * 1000;
        if (Date.now() > windowEnd) continue; // expired — slot is free
        const eStart = new Date(entry.chosenTime).getTime();
        const eEnd   = eStart + durationMins * 60 * 1000;
        // Overlap check
        if (start < eEnd && end > eStart) return true;
    }
    return false;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action } = req.query;

    // ─── GET SOFT BOOKINGS FILE (for check-booking-status logic) ─────────────
    if (action === 'get') {
        const { sessionId } = req.body || {};
        if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
        const soft = readSoftBookings();
        const entry = soft[sessionId];
        if (!entry) return res.status(200).json({ status: 'none' });
        return res.status(200).json(entry);
    }

    // ─── SAVE SOFT BOOKING ───────────────────────────────────────────────────
    if (action === 'save') {
        const {
            sessionId, fingerprint, clientName, clientContact,
            projectTitle, projectDesc, budgetTier, chosenTime
        } = req.body || {};

        if (!sessionId || !chosenTime) {
            return res.status(400).json({ error: 'Missing sessionId or chosenTime' });
        }

        const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);
        const eventStart = new Date(chosenTime);
        const eventEnd   = new Date(eventStart.getTime() + durationMins * 60 * 1000);

        // STEP 1: Time window 5:30–9:30 PM IST
        if (!isTimeInWindow(eventStart)) {
            return res.status(400).json({
                error: 'outside_hours',
                message: "That time is outside available hours. Hardik is free 5:30–9:30 PM IST only."
            });
        }

        // STEP 2: Weekday Mon–Fri
        if (!isWeekday(eventStart)) {
            return res.status(400).json({
                error: 'weekend',
                message: "Hardik isn't available on weekends. Pick a weekday (Mon–Fri)."
            });
        }

        // STEP 3: At least 1 hour from now
        const minimumTime = new Date(Date.now() + 60 * 60 * 1000);
        if (eventStart < minimumTime) {
            return res.status(400).json({
                error: 'too_soon',
                message: "Need at least 1 hour notice. Pick a later time."
            });
        }

        // STEP 4: Clash — Google Calendar
        const { getFreeSlots } = require('../lib/googleCalendar');
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

        // STEP 4: Clash — soft-bookings.json
        if (softClash(chosenTime, durationMins, sessionId)) {
            let slots = [];
            try { slots = await getFreeSlots(); } catch(e) {}
            return res.status(409).json({
                error: 'slot_taken',
                message: "That slot is already taken. Pick a different time.",
                slots
            });
        }

        // Write soft booking
        const soft = readSoftBookings();
        soft[sessionId] = {
            sessionId,
            fingerprint: fingerprint || '',
            clientName: clientName || 'Client',
            clientContact: clientContact || '',
            projectTitle: projectTitle || 'Discovery Call',
            projectDesc: projectDesc || '',
            budgetTier: budgetTier || 'Unknown',
            chosenTime,
            softBookedAt: new Date().toISOString(),
            rescheduleCount: 0,
            status: 'soft'
        };
        writeSoftBookings(soft);

        return res.status(200).json({ saved: true });
    }

    // ─── UPDATE (reschedule) SOFT BOOKING ────────────────────────────────────
    if (action === 'update') {
        const { sessionId, newTime } = req.body || {};
        if (!sessionId || !newTime) return res.status(400).json({ error: 'Missing params' });

        const soft = readSoftBookings();
        const entry = soft[sessionId];
        if (!entry || entry.status !== 'soft') return res.status(404).json({ error: 'Soft booking not found or not active' });

        const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);
        const eventStart = new Date(newTime);
        const eventEnd   = new Date(eventStart.getTime() + durationMins * 60 * 1000);

        // STEP 1: Time window 5:30–9:30 PM IST
        if (!isTimeInWindow(eventStart)) {
            return res.status(400).json({
                error: 'outside_hours',
                message: "That time is outside available hours. Hardik is free 5:30–9:30 PM IST only."
            });
        }

        // STEP 2: Weekday Mon–Fri
        if (!isWeekday(eventStart)) {
            return res.status(400).json({
                error: 'weekend',
                message: "Hardik isn't available on weekends. Pick a weekday (Mon–Fri)."
            });
        }

        // STEP 3: At least 1 hour from now
        const minimumTime = new Date(Date.now() + 60 * 60 * 1000);
        if (eventStart < minimumTime) {
            return res.status(400).json({
                error: 'too_soon',
                message: "Need at least 1 hour notice. Pick a later time."
            });
        }

        // STEP 4: Clash — Calendar + soft-bookings (excluding self)
        const calFree = await isSlotFree(eventStart, eventEnd);
        if (!calFree) {
            return res.status(409).json({
                error: 'slot_taken',
                message: "That slot is already taken. Pick a different time."
            });
        }
        if (softClash(newTime, durationMins, sessionId)) {
            return res.status(409).json({
                error: 'slot_taken',
                message: "That slot is already taken. Pick a different time."
            });
        }

        // Update
        entry.chosenTime = newTime;
        entry.rescheduleCount = (entry.rescheduleCount || 0) + 1;
        soft[sessionId] = entry;
        writeSoftBookings(soft);

        return res.status(200).json({
            updated: true,
            rescheduleCount: entry.rescheduleCount,
            remaining: 3 - entry.rescheduleCount
        });
    }

    // ─── CANCEL SOFT BOOKING ─────────────────────────────────────────────────
    if (action === 'cancel') {
        const { sessionId } = req.body || {};
        if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
        const soft = readSoftBookings();
        if (soft[sessionId]) {
            soft[sessionId].status = 'cancelled';
            writeSoftBookings(soft);
        }
        return res.status(200).json({ cancelled: true });
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=save|update|cancel|get' });
};

// Export helpers for use in finalize-booking.js
module.exports.readSoftBookings  = readSoftBookings;
module.exports.writeSoftBookings = writeSoftBookings;
module.exports.softClash         = softClash;
