require('dotenv').config({ path: '.env.local' });
const { callAI } = require('../lib/gemini');
const { getSystemPrompt, getPostBookingPrompt } = require('../lib/agentPrompt');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        const { messages, sessionId, mode } = req.body;
        const systemPrompt = mode === 'post_booking' ? getPostBookingPrompt() : getSystemPrompt();
        
        let reply = await callAI(messages, systemPrompt);
        
        let summaryData = null;
        let budgetTier = null;
        
        // Extract internal BUDGET_SIGNAL without exposing to client
        const budgetMatch = reply.match(/BUDGET_SIGNAL:\[(.*?)\]/);
        if (budgetMatch) {
            budgetTier = budgetMatch[1];
            reply = reply.replace(budgetMatch[0], '').trim();
        }
        
        // Extract internal AGENT_SUMMARY_READY JSON block
        const summaryMatch = reply.match(/AGENT_SUMMARY_READY:({.*})/s);
        if (summaryMatch) {
            try {
                summaryData = JSON.parse(summaryMatch[1]);
                reply = reply.replace(summaryMatch[0], '').trim();
            } catch (e) { console.error("Summary Parse Error:", e); }
        }
        
        reply = reply.trim();
        res.status(200).json({ reply, summaryData, budgetTier });
        
    } catch (e) {
        console.error("Agent Error:", e);
        res.status(500).json({ error: e.message });
    }
};

