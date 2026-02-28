require('dotenv').config({ path: '.env.local' });
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const brief = req.body;
    console.log('[notify-owner] Received brief:', JSON.stringify(brief));
    
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!token || !chatId) {
      return res.status(500).json({ error: 'Missing Telegram credentials' });
    }

    const meetLine = brief.meetLink && brief.meetLink !== 'Will be sent separately'
      ? `\n🔗 <b>Meet Link:</b> ${brief.meetLink}`
      : '';

    const message = `🔔 <b>NEW LEAD — Kai Portfolio Agent</b>

👤 <b>Name:</b> ${brief.clientName || 'N/A'}
📱 <b>Contact:</b> ${brief.clientContact || 'N/A'}

📋 <b>Project:</b> ${brief.projectTitle || 'N/A'}
📝 <b>Brief:</b> ${brief.projectDesc || 'N/A'}
💰 <b>Budget Tier:</b> ${brief.budgetTier || 'Unknown'}

🗓 <b>Preferred Time:</b> ${brief.meetingDateTime || brief.proposedSlot || 'N/A'}${meetLine}`;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    // Encode eventId + fingerprint into button callback_data
    const callbackBase = JSON.stringify({
      fp: brief.fingerprint || '',
      eid: brief.eventId || ''
    });
    // Telegram callback_data max 64 bytes — use short keys
    const rescheduleData = `RESCHEDULE:${brief.fingerprint || ''}:${brief.eventId || ''}`;
    const cancelData = `CANCEL:${brief.fingerprint || ''}:${brief.eventId || ''}`;

    const telegramRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔄 Reschedule', callback_data: rescheduleData },
            { text: '❌ Cancel Meeting', callback_data: cancelData }
          ]]
        }
      })
    });

    const telegramData = await telegramRes.json();
    console.log('[notify-owner] Telegram response:', JSON.stringify(telegramData));

    if (!telegramData.ok) {
      return res.status(500).json({ error: telegramData.description });
    }

    return res.status(200).json({ sent: true });

  } catch (err) {
    console.error('[notify-owner] FATAL:', err);
    return res.status(500).json({ error: err.message });
  }
};
