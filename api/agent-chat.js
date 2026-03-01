require('dotenv').config({ path: '.env.local' });
const { callAI } = require('../lib/gemini');
const { getSystemPrompt, getPostBookingPrompt } = require('../lib/agentPrompt');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        const { messages, sessionId, mode } = req.body;
        const systemPrompt = mode === 'post_booking' ? getPostBookingPrompt() : getSystemPrompt();
        
        let reply = await callAI(messages, systemPrompt);
        
        let confirmationData = null; // replaces old summaryData — triggers the confirmation card
        let budgetTier = null;

        // Extract BUDGET_SIGNAL without exposing to client
        const budgetMatch = reply.match(/BUDGET_SIGNAL:\[(.*?)\]/);
        if (budgetMatch) {
            budgetTier = budgetMatch[1];
            reply = reply.replace(budgetMatch[0], '').trim();
        }

        // Extract SHOW_CONFIRMATION_CARD JSON block (new flow)
        const confirmMatch = reply.match(/SHOW_CONFIRMATION_CARD:({[\s\S]*?})\s*$/m);
        if (confirmMatch) {
            try {
                confirmationData = JSON.parse(confirmMatch[1]);
                reply = reply.replace(confirmMatch[0], '').trim();
            } catch (e) {
                console.error('[agent-chat] SHOW_CONFIRMATION_CARD parse error:', e.message);
            }
        }

        // Legacy: also handle AGENT_SUMMARY_READY just in case LLM uses old tag
        if (!confirmationData) {
            const legacyMatch = reply.match(/AGENT_SUMMARY_READY:({[\s\S]*?})\s*$/m);
            if (legacyMatch) {
                try {
                    confirmationData = JSON.parse(legacyMatch[1]);
                    reply = reply.replace(legacyMatch[0], '').trim();
                } catch (e) { console.error('[agent-chat] Legacy summary parse error:', e.message); }
            }
        }

        reply = reply.trim();
        res.status(200).json({ reply, confirmationData, budgetTier });
        
    } catch (e) {
        console.error('[agent-chat] Error:', e);
        res.status(500).json({ error: e.message });
    }
};
