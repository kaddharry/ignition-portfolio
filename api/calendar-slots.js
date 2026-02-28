require('dotenv').config({ path: '.env.local' });
const { getFreeSlots } = require('../lib/googleCalendar');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        const slots = await getFreeSlots();
        res.status(200).json({ slots });
    } catch (e) {
        console.error("Calendar Error:", e);
        res.status(500).json({ error: e.message });
    }
};
