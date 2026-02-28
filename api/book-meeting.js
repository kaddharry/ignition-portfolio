require('dotenv').config({ path: '.env.local' });
const { createMeetingEvent } = require('../lib/googleCalendar');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { slot, clientName, clientEmail, clientContact, projectTitle } = req.body;
    
    console.log('[book-meeting] Request:', { slot, clientName, projectTitle });
    
    // Parse slot — accept ISO or natural language (fall back to tomorrow 10am IST)
    let eventStart;
    if (slot && slot.match(/\d{4}-\d{2}-\d{2}/)) {
      eventStart = new Date(slot);
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      eventStart = tomorrow;
      console.log('[book-meeting] Natural language slot, defaulting to tomorrow 10am IST');
    }
    
    const eventEnd = new Date(eventStart.getTime() + 30 * 60 * 1000);
    
    const result = await createMeetingEvent(
      eventStart.toISOString(),
      eventEnd.toISOString(),
      clientName || 'Client',
      clientEmail || '',
      projectTitle || 'Discovery Call'
    );
    
    console.log('[book-meeting] Event created:', result);
    
    res.status(200).json({
      meetLink: result.meetLink || '',
      eventId: result.eventId || '',
      htmlLink: result.htmlLink || '',
      startTime: eventStart.toISOString()
    });
    
  } catch (err) {
    console.error('[book-meeting] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
