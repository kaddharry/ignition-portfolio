require('dotenv').config({ path: '.env.local' });
const { parseNaturalSlot, validateWorkingHours } = require('../lib/timeUtils');

// POST /api/parse-time
// Body: { text: "monday 7pm" }
// Returns: { valid: true, iso: "...", istLabel: "..." } or { valid: false, message: "..." }
module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { text } = req.body || {};
    if (!text) return res.status(400).json({ valid: false, message: 'No time text provided.' });

    const parsed = parseNaturalSlot(text);
    if (!parsed || isNaN(parsed.getTime())) {
        return res.status(200).json({ valid: false, message: "I couldn't understand that time. Try something like 'Monday 7 PM'." });
    }

    // 1-hour minimum notice check
    const minimumTime = new Date(Date.now() + 60 * 60 * 1000);
    if (parsed < minimumTime) {
        return res.status(200).json({ valid: false, message: "That time is too soon — need at least 1 hour notice. Pick a future time!" });
    }

    // Working hours check
    const hoursErr = validateWorkingHours(parsed);
    if (hoursErr) {
        return res.status(200).json({
            valid: false,
            message: "That time is outside Hardik's availability. He's free Mon–Fri, 5:30–9:30 PM IST only. Pick a time in that window!"
        });
    }

    const istLabel = parsed.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'
    });

    res.status(200).json({ valid: true, iso: parsed.toISOString(), istLabel });
};
