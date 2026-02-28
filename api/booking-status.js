require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

// GET /api/booking-status?fp=<fingerprint>
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const { fp } = req.query;
  if (!fp) return res.status(400).json({ error: 'Missing fingerprint' });

  try {
    const filePath = path.join(process.cwd(), 'data', 'bookings.json');
    if (!fs.existsSync(filePath)) return res.status(200).json({ status: 'confirmed' });

    const bookings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const booking = bookings[fp];

    if (!booking) return res.status(200).json({ status: 'confirmed' });

    res.status(200).json({
      status: booking.status || 'confirmed',
      newTime: booking.newTime || null,
      clientName: booking.clientName || ''
    });
  } catch (err) {
    console.error('[booking-status] Error:', err);
    res.status(500).json({ error: err.message });
  }
};
