require('dotenv').config({ path: '.env.local' });
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const brief = req.body;
    console.log('[notify-owner] Received brief:', JSON.stringify(brief));
    
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    console.log('[notify-owner] Token exists:', !!token);
    console.log('[notify-owner] ChatId:', chatId);
    
    if (!token || !chatId) {
      console.error('[notify-owner] Missing Telegram credentials!');
      return res.status(500).json({ error: 'Missing Telegram credentials' });
    }

    const message = `🔔 <b>NEW LEAD — Kai Portfolio Agent</b>

👤 <b>Name:</b> ${brief.clientName || 'N/A'}
📧 <b>Email:</b> ${brief.clientEmail || 'N/A'}
📱 <b>Contact:</b> ${brief.clientContact || 'N/A'}

📋 <b>Project:</b> ${brief.projectTitle || 'N/A'}
📝 <b>Brief:</b> ${brief.projectDesc || 'N/A'}
⏱ <b>Timeline:</b> ${brief.timeline || 'N/A'}
💰 <b>Budget Tier:</b> ${brief.budgetTier || 'Unknown'}

🗓 <b>Preferred Time:</b> ${brief.proposedSlot || 'N/A'}`;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    console.log('[notify-owner] Sending to URL:', url.replace(token, 'TOKEN_HIDDEN'));

    const telegramRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    const telegramData = await telegramRes.json();
    console.log('[notify-owner] Telegram response:', JSON.stringify(telegramData));

    if (!telegramData.ok) {
      console.error('[notify-owner] Telegram error:', telegramData.description);
      return res.status(500).json({ error: telegramData.description });
    }

    return res.status(200).json({ sent: true });

  } catch (err) {
    console.error('[notify-owner] FATAL:', err);
    return res.status(500).json({ error: err.message });
  }
};
