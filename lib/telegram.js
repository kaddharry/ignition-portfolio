require('dotenv').config({ path: '.env.local' });
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

async function sendOwnerAlert(briefData) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!token || !chatId) {
        console.warn("Missing Telegram credentials. Alert suppressed.");
        return { success: false, error: 'Missing token/chatId' };
    }

    const message = `
🔔 <b>NEW CLIENT LEAD — Kai Portfolio Agent</b>

👤 <b>Name:</b> ${briefData.clientName || 'N/A'}
📱 <b>Contact:</b> ${briefData.clientContact || 'N/A'}

📋 <b>Project:</b> ${briefData.projectTitle || 'N/A'}
📝 <b>Brief:</b> ${briefData.projectDesc || 'N/A'}
💰 <b>Budget Tier:</b> ${briefData.budgetTier || 'Unknown'}

🗓 <b>Target Slot:</b> ${briefData.proposedSlot || 'Unknown'}

<i>Reply to this text to follow up!</i>
`;

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
        
        const data = await res.json();
        console.log("Telegram API Response:", data);
        
        if (!res.ok) {
            return { success: false, error: data.description };
        }
        return { success: true };
    } catch (e) {
        console.error("Telegram exact error:", e);
        return { success: false, error: e.message };
    }
}

module.exports = { sendOwnerAlert };
