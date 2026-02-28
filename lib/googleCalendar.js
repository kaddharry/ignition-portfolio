require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');

function getOAuthClient() {
    const oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    return oAuth2Client;
}

// Parse "17:30" or "17" → total minutes from midnight
function parseToMins(envVal, defaultVal) {
    const str = String(envVal || defaultVal);
    const parts = str.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

async function getFreeSlots() {
    const calendar = google.calendar({ version: 'v3', auth: getOAuthClient() });

    const tz = process.env.OWNER_TIMEZONE || 'Asia/Kolkata';
    const startMins = parseToMins(process.env.WORK_START_HOUR, '9:00');   // e.g. 17:30 → 1050
    const endMins   = parseToMins(process.env.WORK_END_HOUR,   '18:00');  // e.g. 21:30 → 1290
    const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30, 10);

    const now = new Date();
    const minTime = new Date(now.getTime() + 60 * 60 * 1000); // 1h buffer
    const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Fetch busy blocks from Google Calendar
    const calId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const res = await calendar.freebusy.query({
        requestBody: {
            timeMin: minTime.toISOString(),
            timeMax: timeMax.toISOString(),
            timeZone: tz,
            items: [{ id: calId }]
        }
    });
    const busyBlocks = res.data.calendars[calId]?.busy || [];
    const slots = [];

    // Build slots day by day in IST
    for (let day = 0; day <= 14 && slots.length < 5; day++) {
        const dayCandidate = new Date(now.getTime() + day * 24 * 60 * 60 * 1000);
        // Get IST date as YYYY-MM-DD (en-CA locale gives ISO-style date)
        const istDateStr = dayCandidate.toLocaleDateString('en-CA', { timeZone: tz });

        // Get IST day-of-week: build a noon UTC date from IST date string
        // +05:30 offset: noon IST = 06:30 UTC, safely the same calendar day
        const istDow = new Date(istDateStr + 'T06:30:00Z').getDay(); // 0=Sun, 6=Sat
        if (istDow === 0 || istDow === 6) continue; // skip weekends

        // Iterate slots in total-minutes space so half-hour starts work
        for (let slotMin = startMins; slotMin + durationMins <= endMins && slots.length < 5; slotMin += durationMins) {
            const hh = String(Math.floor(slotMin / 60)).padStart(2, '0');
            const mm = String(slotMin % 60).padStart(2, '0');
            // Build IST datetime — IST is UTC+5:30
            const slotIST = new Date(`${istDateStr}T${hh}:${mm}:00+05:30`);
            const slotEnd = new Date(slotIST.getTime() + durationMins * 60000);

            // Must be at least 1 hour from now
            if (slotIST < minTime) continue;

            // Check that the END of this slot doesn't exceed working hours end
            const slotEndMins = slotMin + durationMins;
            if (slotEndMins > endMins) continue;

            // Check against busy blocks
            const isBusy = busyBlocks.some(b => {
                const bStart = new Date(b.start);
                const bEnd   = new Date(b.end);
                return slotIST < bEnd && slotEnd > bStart;
            });

            if (!isBusy) {
                slots.push({
                    time: slotIST.toLocaleString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric',
                        hour: 'numeric', minute: '2-digit',
                        timeZone: tz
                    }),
                    iso: slotIST.toISOString()
                });
            }
        }
    }

    return slots;
}


async function createMeetingEvent(startISO, endISO, clientName, clientEmail, projectTitle) {
    const auth = getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });
    
    const attendees = [{ email: process.env.OWNER_EMAIL }];
    if (clientEmail && clientEmail.includes('@')) {
        attendees.push({ email: clientEmail });
    }
    
    const event = {
        summary: `Discovery Call — ${projectTitle}`,
        description: `Client: ${clientName}\nProject: ${projectTitle}\nBooked via Kai Portfolio Agent`,
        start: { dateTime: startISO, timeZone: process.env.OWNER_TIMEZONE || 'Asia/Kolkata' },
        end: { dateTime: endISO, timeZone: process.env.OWNER_TIMEZONE || 'Asia/Kolkata' },
        attendees,
        conferenceData: {
            createRequest: {
                requestId: `kai-${Date.now()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
        },
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'email', minutes: 60 },
                { method: 'popup', minutes: 15 }
            ]
        }
    };
    
    const response = await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all'
    });
    
    const meetLink =
        response.data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri ||
        response.data.hangoutLink ||
        '';
    
    console.log('[googleCalendar] Event created. Meet link:', meetLink);
    
    return {
        meetLink,
        eventId: response.data.id,
        htmlLink: response.data.htmlLink
    };
}

async function isSlotFree(startDate, endDate) {
    try {
        const auth = getOAuthClient();
        const calendar = google.calendar({ version: 'v3', auth });
        
        const response = await calendar.events.list({
            calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true
        });
        
        const overlapping = (response.data.items || []).filter(ev => ev.status !== 'cancelled');
        return overlapping.length === 0;
    } catch (e) {
        console.error('[isSlotFree] Error:', e.message);
        return true; // default to free — don't block client if check fails
    }
}

async function rescheduleMeetingEvent(eventId, newStartISO, newEndISO) {
    const auth = getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.events.patch({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        eventId,
        resource: {
            start: { dateTime: newStartISO, timeZone: process.env.OWNER_TIMEZONE || 'Asia/Kolkata' },
            end: { dateTime: newEndISO, timeZone: process.env.OWNER_TIMEZONE || 'Asia/Kolkata' }
        },
        sendUpdates: 'all'
    });

    const meetLink =
        response.data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri ||
        response.data.hangoutLink || '';

    console.log('[googleCalendar] Rescheduled event:', eventId, 'to', newStartISO);
    return { meetLink, eventId: response.data.id };
}

async function deleteMeetingEvent(eventId) {
    const auth = getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        eventId,
        sendUpdates: 'all'
    });

    console.log('[googleCalendar] Deleted event:', eventId);
    return { deleted: true };
}

module.exports = { getOAuthClient, getFreeSlots, createMeetingEvent, isSlotFree, rescheduleMeetingEvent, deleteMeetingEvent };
