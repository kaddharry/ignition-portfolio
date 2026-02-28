
My portfolio is already live at https://ignition-portfolio.vercel.app
It is built with pure HTML, Vanilla CSS, and Vanilla JavaScript using Vite.
There is currently NO backend — everything is frontend only.

My current package.json is exactly this — do not overwrite it, only ADD to it:
```json
{
  "name": "portfolio",
  "version": "1.0.0",
  "description": "High-performance scrollytelling portfolio",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

Important notes about this project:
- NO "type": "module" in package.json — use CommonJS (require/module.exports) in all api/ and lib/ files
- The frontend (index.html, css/, js/) uses vanilla JS — do NOT touch these files
- Vite is only used for the frontend — the api/ folder is Vercel serverless functions, not Vite
- Zero dependencies installed yet — you must install everything needed

I need you to add a complete backend + AI hiring agent to this project.
Read the full context in GEMINI.md and coding rules in .antigravity/rules.md before writing any code.

Here is everything you need to do, in order:

---

## STEP 1 — Project Structure Setup

First, show me the current file structure of this project so we both know what exists.
Then create this new structure alongside the existing files without touching anything that already exists:

```
/
├── .env.local                        ← I already have this file, don't overwrite it
├── .gitignore                        ← Add/update to include .env.local and node_modules
├── api/                              ← Vercel serverless functions (acts as our backend)
│   ├── agent-chat.js                 ← AI chat endpoint
│   ├── calendar-slots.js             ← Google Calendar free slots
│   ├── book-meeting.js               ← Create event + Meet link
│   └── notify-owner.js              ← Send Telegram alert
├── lib/                              ← Shared helper modules
│   ├── agentPrompt.js                ← System prompt builder
│   ├── gemini.js                     ← Gemini primary + Groq fallback
│   ├── googleCalendar.js             ← Calendar helpers
│   └── telegram.js                   ← Telegram notification
├── scripts/
│   └── get-google-token.js           ← One-time refresh token generator
├── src/
│   └── hiring-agent/
│       ├── index.js                  ← Widget entry, injects into existing portfolio
│       ├── chat.js                   ← Chat UI logic
│       └── styles.css                ← Widget styles (dark, matches portfolio aesthetic)
└── vercel.json                       ← Routing config so /api/* works on Vercel
```

---

## STEP 2 — Install Dependencies

Run these commands and tell me what each one does so I learn:

```bash
npm install @google/generative-ai groq-sdk googleapis google-auth-library node-fetch dotenv
npm install -D @vercel/node
```

Explain each package in one line after installing.

IMPORTANT: All api/ and lib/ files must use CommonJS syntax:
- Use: const x = require('x') and module.exports = { }
- Do NOT use: import x from 'x' or export default
This is because there is no "type": "module" in package.json.

---

## STEP 3 — Build the Backend (api/ folder)

### api/agent-chat.js
- Method: POST only (return 405 for anything else)
- Body: { messages: [], sessionId: string }
- Import callAI from ../lib/gemini.js
- Import getSystemPrompt from ../lib/agentPrompt.js
- Strip BUDGET_SIGNAL and AGENT_SUMMARY_READY tags from reply before sending to frontend
- Parse and return summaryData and budgetTier separately if detected
- Return: { reply, summaryData, budgetTier }
- Wrap everything in try/catch, return { error } on failure

### api/calendar-slots.js
- Method: GET only
- Import getFreeSlots from ../lib/googleCalendar.js
- Return: { slots: [] } — array of ISO datetime strings
- Slots must be within WORK_START_HOUR to WORK_END_HOUR in OWNER_TIMEZONE
- Only return slots from next 14 days, max 5 slots

### api/book-meeting.js
- Method: POST only
- Body: { slot, clientName, clientEmail, clientContact, projectTitle }
- Import createMeetingEvent from ../lib/googleCalendar.js
- Return: { meetLink, eventId }

### api/notify-owner.js
- Method: POST only
- Body: full brief object (clientName, email, contact, projectTitle, projectDesc, audience, timeline, budgetTier, meetLink, meetingDateTime)
- Import sendOwnerAlert from ../lib/telegram.js
- Return: { sent: true }

---

## STEP 4 — Build the Lib Helpers (lib/ folder)

### lib/agentPrompt.js
Export getSystemPrompt() that returns a string using process.env values.
The prompt must guide the AI through these 7 stages:

Stage 1 — WELCOME: Tell client if Hardik is available (IS_AVAILABLE env var).
  If true: "Hardik is currently available for new projects"
  If false: show CURRENT_PROJECT value

Stage 2 — DISCOVERY: Extract the project idea. Ask ONE question at a time, never multiple.
  Questions: What's the project about? Who is the audience? What problem does it solve? Timeline?

Stage 3 — REFINEMENT: Sharpen their idea. Point out things they haven't considered
  (mobile-first, scalability, integrations, tech stack). Summarize the refined brief back to them.

Stage 4 — BUDGET INTEL: Infer budget WITHOUT asking directly. Use these anchoring questions:
  - "What's the business impact if this launches in 2 months vs 6 months?"
  - "Are you thinking MVP to validate, or full production product?"
  - "Is this your first quote or have you spoken to other developers?"
  - "What's the cost of not building this?"
  Internally classify as one of: [Budget: <$500] [Mid: $500–$2000] [Premium: $2000–$5000] [Enterprise: $5000+]
  Tag the message internally: BUDGET_SIGNAL:[tier] — never show this tag to the client

Stage 5 — CAPTURE: Collect name, email, Telegram username or phone number

Stage 6 — SLOT BOOKING: Tell the client you're checking Hardik's calendar.
  Say: "Let me pull up some available slots for you..."
  Then write: FETCH_SLOTS — this triggers the frontend to call /api/calendar-slots
  Do not make up time slots yourself.

Stage 7 — CONFIRM: After client picks a slot, confirm the meeting.
  Write: AGENT_SUMMARY_READY:{"clientName":"...","clientEmail":"...","clientContact":"...","projectTitle":"...","projectDesc":"...","audience":"...","timeline":"...","budgetTier":"...","proposedSlot":"..."}
  This triggers the frontend to call /api/book-meeting and /api/notify-owner

Tone: Warm, sharp, entrepreneurial. You are Kai — Hardik's concierge assistant.
Never say you are an AI unless directly asked.

### lib/gemini.js
Export callAI(messages, systemPrompt):
- Try Gemini 2.0 Flash first using @google/generative-ai
  Model: gemini-2.0-flash
  Pass full messages array + systemPrompt
- On ANY error: catch, log "[Gemini failed → switching to Groq]", call Groq
- Groq model: llama-3.3-70b-versatile using groq-sdk
- Both use identical messages format
- Return plain text string

### lib/googleCalendar.js
Export three functions:

getOAuthClient():
- Build OAuth2 client using google-auth-library
- Use GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
- Set credentials with GOOGLE_REFRESH_TOKEN
- Return authenticated client

getFreeSlots():
- Call getOAuthClient()
- Query Google Calendar API for events in next 14 days
- Find gaps >= MEETING_DURATION_MINS between WORK_START_HOUR and WORK_END_HOUR
- Convert to OWNER_TIMEZONE
- Return max 5 slots as human-readable strings AND ISO strings
- NEVER include event titles — privacy

createMeetingEvent(slot, clientName, clientEmail, projectTitle):
- Call getOAuthClient()
- Create Calendar event with:
  - Summary: "Discovery Call — [projectTitle]"
  - Start: slot (ISO)
  - End: slot + MEETING_DURATION_MINS
  - Attendees: OWNER_EMAIL + clientEmail
  - conferenceData: { createRequest: { requestId: uuid } }
  - conferenceDataVersion: 1
- Return { meetLink, eventId }

### lib/telegram.js
Export sendOwnerAlert(briefData):
- Use fetch to call https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage
- Send to TELEGRAM_CHAT_ID
- Message format (HTML parse mode):

```
🔔 <b>NEW CLIENT LEAD — Kai Portfolio Agent</b>

👤 <b>Name:</b> {clientName}
📧 <b>Email:</b> {clientEmail}
📱 <b>Contact:</b> {clientContact}

📋 <b>Project:</b> {projectTitle}
📝 <b>Brief:</b> {projectDesc}
👥 <b>Audience:</b> {audience}
⏱ <b>Timeline:</b> {timeline}
💰 <b>Budget Tier:</b> {budgetTier}

🗓 <b>Meeting:</b> {meetingDateTime}
🔗 <b>Google Meet:</b> {meetLink}

<i>Reply to this message to follow up with the client.</i>
```

- Return true on success, false on failure

---

## STEP 5 — Refresh Token Script

### scripts/get-google-token.js
This is a one-time script I will run locally to get my Google refresh token.

Build it to:
1. Read GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI from .env.local
   (use dotenv to load the file)
2. Build an OAuth2 authorization URL for scope: https://www.googleapis.com/auth/calendar.events
3. Print this message clearly:
   "Open this URL in your browser and authorize access:"
   Then print the URL
4. Start an HTTP server on port 5173 at path /api/auth/google/callback
5. When Google redirects back with the auth code, exchange it for tokens
6. Print clearly:
   "✅ SUCCESS! Copy this into your .env.local as GOOGLE_REFRESH_TOKEN:"
   Then print the refresh_token value
7. Shut down the server and exit

After creating the script, tell me:
"Run this command in your terminal: node scripts/get-google-token.js"
Then walk me through what will happen step by step.

---

## STEP 6 — Frontend Widget (src/hiring-agent/)

Build a floating chat widget in Vanilla JS that injects itself into the existing portfolio.

### src/hiring-agent/index.js
- Creates a floating button (bottom-right corner)
- Injects the chat window into document.body
- Imports and initializes chat.js and styles.css
- Add to existing portfolio by adding one line to the main HTML:
  <script type="module" src="/src/hiring-agent/index.js"></script>

### src/hiring-agent/chat.js
Manages the full conversation:

- On open: POST to /api/agent-chat with initial greeting message
- Each user message: POST to /api/agent-chat with full history
- Detect FETCH_SLOTS in reply → call GET /api/calendar-slots → show SlotPicker UI
- Detect summaryData in response → call POST /api/book-meeting → call POST /api/notify-owner
- Show success card with Meet link, date/time, "Check your email for the calendar invite"
- Store conversation history in memory (plain JS array, no localStorage)

### src/hiring-agent/styles.css
Dark theme matching the portfolio:
- Background: #0a0a0a with subtle grain texture
- Accent color: red (#ff1801) — matches F1/ignition theme
- Font: match existing portfolio font
- Floating button: circle, bottom-right, subtle pulse animation
- Chat window: 380px wide, 520px tall, rounded corners, smooth open/close animation
- Messages: user messages right-aligned (red accent), bot messages left-aligned (dark card)
- Typing indicator: three bouncing dots

---

## STEP 7 — Vercel Configuration

### vercel.json
Create this so Vercel correctly routes /api/* to the serverless functions:

```json
{
  "functions": {
    "api/*.js": {
      "runtime": "@vercel/node@3"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ]
}
```

### .gitignore
Make sure these are included:
```
.env.local
node_modules/
dist/
scripts/get-google-token.js
```

---

## STEP 8 — Final Checklist

After building everything, go through this checklist and confirm each item:

- [ ] All API keys read from process.env — none hardcoded
- [ ] .env.local is in .gitignore
- [ ] Gemini → Groq fallback tested with a sample message
- [ ] Google Calendar returns slots without exposing event titles
- [ ] Telegram alert sends correctly (test with sample data)
- [ ] Widget injects into portfolio without breaking existing JS/CSS
- [ ] vercel.json is correctly configured
- [ ] scripts/get-google-token.js is ready to run

Then tell me exactly:
1. Which files to add to my project and where
2. How to run the refresh token script
3. How to test locally
4. How to deploy to Vercel with the env vars
