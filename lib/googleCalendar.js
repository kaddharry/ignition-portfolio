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

async function getFreeSlots() {
    const calendar = google.calendar({ version: 'v3', auth: getOAuthClient() });
    
    const tz = process.env.OWNER_TIMEZONE || 'UTC';
    const startHour = parseInt(process.env.WORK_START_HOUR || 10, 10);
    const endHour = parseInt(process.env.WORK_END_HOUR || 18, 10);
    const durationMins = parseInt(process.env.MEETING_DURATION_MINS || 30, 10);
    
    const now = new Date();
    const timeMin = new Date(now.getTime() + 24 * 60 * 60 * 1000); 
    const timeMax = new Date(timeMin.getTime() + 14 * 24 * 60 * 60 * 1000);
    
    const res = await calendar.freebusy.query({
        requestBody: {
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            timeZone: tz,
            items: [{ id: 'primary' }]
        }
    });
    
    const busyBlocks = res.data.calendars.primary.busy || [];
    const slots = [];
    
    for (let day = 0; day < 14; day++) {
        let currentDay = new Date(timeMin.getTime() + day * 24 * 60 * 60 * 1000);
        
        for (let h = startHour; h < endHour; h++) {
            for (let m = 0; m < 60; m += durationMins) {
                let slotStart = new Date(currentDay);
                slotStart.setUTCHours(h, m, 0, 0);
                let slotEnd = new Date(slotStart.getTime() + durationMins * 60000);
                
                if (slotStart.getUTCDay() === 0 || slotStart.getUTCDay() === 6) continue;
                if (slotStart < new Date()) continue;
                
                let isFree = true;
                for (let busy of busyBlocks) {
                    let bStart = new Date(busy.start);
                    let bEnd = new Date(busy.end);
                    if (slotStart < bEnd && slotEnd > bStart) {
                        isFree = false;
                        break;
                    }
                }
                
                if (isFree && slots.length < 5) {
                    slots.push({
                        time: slotStart.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }),
                        iso: slotStart.toISOString()
                    });
                }
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

module.exports = { getOAuthClient, getFreeSlots, createMeetingEvent };
