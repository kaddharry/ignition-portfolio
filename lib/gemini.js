require('dotenv').config({ path: '.env.local' });
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

async function callAI(messages, systemPrompt) {
    // Both APIs expect { role: "user"/"assistant", content: "hello" }
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            systemInstruction: systemPrompt 
        });

        // Convert common messages array format to Gemini chat history format
        const chatHistory = messages.slice(0, -1).map(msg => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
        }));
        
        const latestMessage = messages[messages.length - 1].content;

        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(latestMessage);
        return result.response.text();
        
    } catch (geminiError) {
        console.warn("[Gemini failed → switching to Groq]", geminiError.message);
        
        try {
            const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
            
            // Groq takes system prompt explicitly in the messages array block
            const groqMessages = [
                { role: "system", content: systemPrompt },
                ...messages
            ];
            
            const completion = await groq.chat.completions.create({
                messages: groqMessages,
                model: "llama-3.3-70b-versatile",
            });
            return completion.choices[0].message.content;
            
        } catch (groqError) {
            throw new Error("Both Gemini and Groq fallbacks failed: " + groqError.message);
        }
    }
}

module.exports = { callAI };
