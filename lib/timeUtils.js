require('dotenv').config({ path: '.env.local' });

const TZ = 'Asia/Kolkata';

// ─── Parse "HH:MM" env var → total minutes from midnight ─────────────────────
function envToMins(envVal, def) {
    const str = String(envVal || def);
    const p = str.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
}

// ─── Get today's date in IST as YYYY-MM-DD ────────────────────────────────────
function todayIST() {
    return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

// ─── Build a valid IST date string, return null if date doesn't exist ─────────
// e.g. Feb 29 in a non-leap year → null. March 32 → null.
function buildISTDate(year, month1indexed, day, hour, min) {
    // month1indexed: 1=Jan, 2=Feb, ...12=Dec
    // Build UTC date from the provided values
    const candidate = new Date(Date.UTC(year, month1indexed - 1, day));
    // If JS rolled over (e.g. Feb 29 → Mar 1), the date doesn't exist
    if (
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== month1indexed - 1 ||
        candidate.getUTCDate() !== day
    ) {
        return null; // date doesn't exist in this year
    }
    const yyyy = String(year).padStart(4, '0');
    const mm   = String(month1indexed).padStart(2, '0');
    const dd   = String(day).padStart(2, '0');
    const hh   = String(hour).padStart(2, '0');
    const mi   = String(min).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00+05:30`;
}

// ─── Extract hour + minute from text, with meridiem ──────────────────────────
function extractTime(lower) {
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!timeMatch) return { hour: 17, min: 0 }; // default: 5:00 PM
    let hour = parseInt(timeMatch[1]);
    let min  = parseInt(timeMatch[2] || '0');
    const mer = timeMatch[3];
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    // No meridiem + small hour (1–7) → assume PM (no one books 3 AM)
    if (!mer && hour > 0 && hour < 8) hour += 12;
    return { hour, min };
}

// ─── Parse natural language time → UTC Date (IST-anchored) ───────────────────
// Handles:
//   ISO strings                → pass-through
//   "today 6pm"                → today in IST + time
//   "tomorrow 7:30pm"          → tomorrow in IST + time
//   "monday 7pm"               → NEXT Monday in IST + time (never past)
//   "march 15 7pm" / "15 mar"  → explicit date, validates it exists
// Returns null if date is invalid or can't be parsed.
function parseNaturalSlot(text) {
    if (!text) return null;

    // Already ISO → parse directly
    if (/\d{4}-\d{2}-\d{2}T/.test(text)) return new Date(text);

    const lower = text.toLowerCase().trim();
    const nowIST = todayIST(); // YYYY-MM-DD right now in IST
    const currentYear = parseInt(nowIST.split('-')[0]);

    const { hour, min } = extractTime(lower);
    let istString = null;

    // ── 1. "today" ────────────────────────────────────────────────────────────
    if (lower.includes('today')) {
        const [y, mo, d] = nowIST.split('-').map(Number);
        istString = buildISTDate(y, mo, d, hour, min);

    // ── 2. "tomorrow" ─────────────────────────────────────────────────────────
    } else if (lower.includes('tomorrow')) {
        const [y, mo, d] = nowIST.split('-').map(Number);
        // +1 day via Date.UTC (handles month/year rollovers correctly)
        const tom = new Date(Date.UTC(y, mo - 1, d + 1));
        istString = buildISTDate(
            tom.getUTCFullYear(), tom.getUTCMonth() + 1, tom.getUTCDate(),
            hour, min
        );

    // ── 3. Named weekday ("monday", "tuesday" … "sunday") ────────────────────
    } else {
        const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const monthNames = [
            'january','february','march','april','may','june',
            'july','august','september','october','november','december'
        ];

        // Check for month name first ("march 15", "15th march")
        let foundMonth = false;
        for (let mi = 0; mi < monthNames.length; mi++) {
            if (!lower.includes(monthNames[mi])) continue;
            foundMonth = true;

            // Extract the day number from the text
            // Match a number that isn't preceded by a colon (to avoid matching "7:30")
            const dayMatch = lower.match(/(?<![:\d])(\d{1,2})(?:st|nd|rd|th)?(?![:.\d])/);
            if (!dayMatch) break; // can't parse day → fall through

            const day   = parseInt(dayMatch[1]);
            const month = mi + 1; // 1-indexed
            let year = currentYear;

            // If that month+day has already passed this year, use next year
            const testThisYear = new Date(Date.UTC(year, mi, day));
            const nowDate = new Date(nowIST + 'T00:00:00+05:30');
            if (testThisYear < nowDate) year += 1;

            istString = buildISTDate(year, month, day, hour, min);
            break;
        }

        // No month found → try weekday name
        if (!foundMonth) {
            const todayDow = new Date(nowIST + 'T06:30:00Z').getDay(); // 0=Sun

            for (const name of dayNames) {
                if (!lower.includes(name)) continue;
                const targetDow = dayNames.indexOf(name);
                let diff = targetDow - todayDow;
                if (diff <= 0) diff += 7; // always NEXT occurrence, never today/past
                const [y, mo, d] = nowIST.split('-').map(Number);
                const target = new Date(Date.UTC(y, mo - 1, d + diff));
                istString = buildISTDate(
                    target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(),
                    hour, min
                );
                break;
            }
        }
    }

    if (!istString) {
        // Last resort: let JS try to parse it
        const direct = new Date(text);
        return isNaN(direct.getTime()) ? null : direct;
    }

    const result = new Date(istString);
    return isNaN(result.getTime()) ? null : result;
}

// ─── Check if the time-of-day is within the working window ───────────────────
// Returns true if the slot start AND end (start + duration) fit inside 5:30–9:30 PM IST
function isTimeInWindow(eventStart) {
    const startMins    = envToMins(process.env.WORK_START_HOUR, '17:30');
    const endMins      = envToMins(process.env.WORK_END_HOUR,   '21:30');
    const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30);

    const istHH = parseInt(eventStart.toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: TZ }));
    const istMM = parseInt(eventStart.toLocaleString('en-IN', { minute: 'numeric', timeZone: TZ }));
    const istTotalMins = istHH * 60 + istMM;
    return istTotalMins >= startMins && (istTotalMins + durationMins) <= endMins;
}

// ─── Check if the day is a weekday (Mon–Fri in IST) ──────────────────────────
function isWeekday(eventStart) {
    const istDateStr = eventStart.toLocaleDateString('en-CA', { timeZone: TZ });
    const dow = new Date(istDateStr + 'T06:30:00Z').getDay(); // 0=Sun, 6=Sat
    return dow !== 0 && dow !== 6;
}

// ─── Full working-hours validation (time first, then day) ────────────────────
// Returns null (valid) | 'outside_hours' | 'weekend'
function validateWorkingHours(eventStart) {
    if (!isTimeInWindow(eventStart)) return 'outside_hours';
    if (!isWeekday(eventStart))      return 'weekend';
    return null;
}

module.exports = { parseNaturalSlot, validateWorkingHours, isTimeInWindow, isWeekday, envToMins, todayIST, TZ };
