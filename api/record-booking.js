require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  
  try {
    const { fingerprint, clientName, projectTitle } = req.body;
    if (!fingerprint) return res.status(400).json({ error: 'Missing fingerprint' });

    const dataDir = path.join(process.cwd(), 'data');
    const filePath = path.join(dataDir, 'bookings.json');
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    let bookings = {};
    if (fs.existsSync(filePath)) {
      bookings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    
    bookings[fingerprint] = {
      clientName: clientName || 'Unknown',
      projectTitle: projectTitle || 'Unknown',
      bookedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(filePath, JSON.stringify(bookings, null, 2));
    console.log('[record-booking] Saved fingerprint:', fingerprint);
    res.status(200).json({ recorded: true });
  } catch (err) {
    console.error('[record-booking] Error:', err);
    res.status(500).json({ error: err.message });
  }
};
