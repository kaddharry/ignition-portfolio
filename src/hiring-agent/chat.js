let chatHistory = [];
let sessionId = 'sid_' + Math.random().toString(36).substr(2, 9);
let isAgentTyping = false;
let clientName = '';
let contactCardSubmitted = false;
let isPostBookingMode = false;
let postBookingStage = null; // null | 'awaiting_reschedule_time'
let savedMessages = []; // visual message log for session persistence

// ─── Soft Booking State ───────────────────────────────────────────────────────
let isSoftWindowMode = false;      // true while 30-min window is open
let softRescheduleCount = 0;       // how many reschedules used (max 3)
let softWindowTimer = null;        // setTimeout handle for 30-min timeout
let softWindowBarEl = null;        // DOM element for countdown bar
let softCountdownInterval = null;  // setInterval for countdown display
let softSessionData = null;        // { clientName, clientContact, projectTitle, projectDesc, budgetTier, proposedSlotISO }

const KAI_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const SOFT_WINDOW_MS = 30 * 60 * 1000;   // 30 minutes
const MAX_RESCHEDULES = 3;

// ─── Persistence (localStorage + 48h TTL) ────────────────────────────────────
function saveMessages() {
  const fp = generateFingerprint();
  try {
    localStorage.setItem('kai_msgs_' + fp, JSON.stringify({ ts: Date.now(), msgs: savedMessages }));
  } catch(e) {}
}

function loadSavedMessages() {
  const fp = generateFingerprint();
  try {
    const raw = localStorage.getItem('kai_msgs_' + fp);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > KAI_TTL_MS) {
      localStorage.removeItem('kai_msgs_' + fp);
      return [];
    }
    return parsed.msgs || [];
  } catch(e) { return []; }
}

// ─── Spam Prevention ─────────────────────────────────────────────────────────
function generateFingerprint() {
  const raw = [
    navigator.userAgent,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    screen.colorDepth
  ].join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return 'fp_' + Math.abs(hash).toString(36);
}

function hasAlreadyBooked() {
  const fp = generateFingerprint();
  try {
    const raw = localStorage.getItem('kai_booked_' + fp);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (Date.now() - new Date(data.bookedAt).getTime() > KAI_TTL_MS) {
      localStorage.removeItem('kai_booked_' + fp);
      localStorage.removeItem('kai_msgs_' + fp);
      return false;
    }
    return true;
  } catch { return false; }
}

function getBookedData() {
  const key = 'kai_booked_' + generateFingerprint();
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function markAsBooked(clientNameVal, projectTitleVal, meetLink, eventId, clientContact) {
  const fp = generateFingerprint();
  const key = 'kai_booked_' + fp;
  localStorage.setItem(key, JSON.stringify({
    bookedAt: new Date().toISOString(),
    clientName: clientNameVal,
    projectTitle: projectTitleVal,
    meetLink: meetLink || '',
    eventId: eventId || '',
    fingerprint: fp
  }));
  fetch('/api/record-booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fingerprint: fp,
      clientName: clientNameVal,
      projectTitle: projectTitleVal,
      eventId: eventId || '',
      clientContact: clientContact || ''
    })
  }).catch(() => {});
}

// DOM Elements
let messagesContainer, inputField, sendBtn, typingIndicator;

export function initChat(widgetContainer) {
    widgetContainer.innerHTML = `
        <div class="kai-header">
          <div class="kai-header-identity">
            <div class="kai-header-name">KAI</div>
            <div class="kai-header-sub">AI CONCIERGE</div>
          </div>
          <div class="kai-header-status">
            <span class="kai-status-dot"></span>
            <span class="kai-status-text">ONLINE</span>
          </div>
          <div class="kai-header-actions">
            <button class="kai-btn-expand" id="kai-expand-btn" title="Expand">⤢</button>
            <button class="kai-btn-close" id="kai-close-btn" title="Close">×</button>
          </div>
        </div>
        <div class="kai-messages" id="kai-messages"></div>
        <div class="kai-typing" id="kai-typing" style="display: none;">
            <span class="kai-typing-dot"></span><span class="kai-typing-dot"></span><span class="kai-typing-dot"></span>
        </div>
        <div class="kai-input-area">
            <input type="text" class="kai-input" id="kai-input" placeholder="Message..." autocomplete="off" />
            <button class="kai-send-btn" id="kai-send">RUN</button>
        </div>
        <div class="kai-footer">POWERED BY ANTIGRAVITY ENGINE</div>
    `;

    messagesContainer = document.getElementById('kai-messages');
    inputField = document.getElementById('kai-input');
    sendBtn = document.getElementById('kai-send');
    typingIndicator = document.getElementById('kai-typing');

    document.getElementById('kai-close-btn').addEventListener('click', () => {
        document.getElementById('kai-widget-window').classList.add('kai-hidden');
        document.getElementById('kai-fab').classList.remove('open');
        document.body.classList.remove('kai-chat-open');
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        if (window._kaiAudioWasPaused) {
            const audio = document.getElementById('engineSound');
            if (audio) audio.play().catch(() => {});
            window._kaiAudioWasPaused = false;
        }
        try { screen.orientation?.unlock?.(); } catch(e) {}
        document.getElementById('kai-orient-lock')?.remove();
        contactCardSubmitted = false;
    });
    
    let isExpanded = false;
    document.getElementById('kai-expand-btn').addEventListener('click', () => {
      isExpanded = !isExpanded;
      const win = document.getElementById('kai-widget-window');
      if (isExpanded) {
        win.style.width = '680px';
        win.style.height = '640px';
        document.getElementById('kai-expand-btn').textContent = '⤡';
      } else {
        win.style.width = '380px';
        win.style.height = '520px';
        document.getElementById('kai-expand-btn').textContent = '⤢';
      }
    });

    sendBtn.addEventListener('click', handleSend);
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    // Extract name from input
    inputField.addEventListener('input', () => {
        if (!clientName && chatHistory.length === 2 && inputField.value.length > 2) {
            // Very naive clientName pre-fill logic
            clientName = inputField.value.split(' ')[0];
        }
    });
    
    // Already booked — restore silently, then check if Hardik took action
    if (hasAlreadyBooked()) {
        const bd = getBookedData();
        isPostBookingMode = true;

        // Replay prior messages silently (no new welcome message added)
        const prior = loadSavedMessages();
        savedMessages = prior;
        prior.forEach(m => {
            const msgWrapper = document.createElement('div');
            msgWrapper.className = `kai-msg ${m.role}`;
            const bubble = document.createElement('div');
            bubble.className = 'kai-bubble';
            bubble.innerHTML = m.text;
            msgWrapper.appendChild(bubble);
            messagesContainer.appendChild(msgWrapper);
        });

        // Re-pin Meet link below history (not duplicated in savedMessages)
        if (bd?.meetLink) {
            const linkMsg = document.createElement('div');
            linkMsg.className = 'kai-msg bot';
            const linkBubble = document.createElement('div');
            linkBubble.className = 'kai-bubble';
            linkBubble.innerHTML = `🔗 Your Google Meet link: <a href="${bd.meetLink}" target="_blank">${bd.meetLink}</a>`;
            linkMsg.appendChild(linkBubble);
            messagesContainer.appendChild(linkMsg);
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        inputField.placeholder = 'Ask for link, reschedule or cancel...';

        // Only append something new if Hardik took action (reschedule / cancel)
        const fp = generateFingerprint();
        fetch(`/api/booking-status?fp=${fp}`)
            .then(r => r.json())
            .then(statusData => {
                const status = statusData.status || 'confirmed';
                if (status === 'rescheduled' && statusData.newTime) {
                    appendMessage(
                        `📅 Hardik rescheduled your meeting to <b>${statusData.newTime}</b>. Your Meet link stays the same!`,
                        'bot'
                    );
                } else if (status === 'cancelled') {
                    appendMessage(
                        `Hardik had to cancel this meeting. He'll reach out to you directly to rearrange. You're free to start a new booking now!`,
                        'bot'
                    );
                    // Reset so they can rebook
                    localStorage.removeItem('kai_booked_' + fp);
                    localStorage.removeItem('kai_msgs_' + fp);
                    isPostBookingMode = false;
                    inputField.placeholder = 'Message...';
                }
                // If confirmed: say nothing new — user sees their restored history
            })
            .catch(() => {}); // fail silently — don't add noise
        return;
    }

    // Check for active soft window on refresh (before greeting)
    checkSoftBookingStatus().then(hasSoft => {
        if (!hasSoft) sendInternalGreeting();
    });
}

function appendMessage(text, role) {
    const msgWrapper = document.createElement('div');
    msgWrapper.className = `kai-msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'kai-bubble';
    bubble.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    msgWrapper.appendChild(bubble);
    messagesContainer.appendChild(msgWrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    // Persist to session
    savedMessages.push({ text: bubble.innerHTML, role });
    saveMessages();
}

function appendVNodes(node) {
    messagesContainer.appendChild(node);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendInternalGreeting() {
    chatHistory.push({ role: 'user', content: "Hello, I clicked the widget." });
    await fetchAgentResponse();
}

async function sendMessage(text) {
    // ─── SOFT WINDOW STATE MACHINE ──────────────────────────────────────────────
    if (isSoftWindowMode) {
        appendMessage(text, 'user');
        await handleSoftWindowMessage(text);
        return;
    }

    // ─── POST-BOOKING STATE MACHINE ───────────────────────────────────────────
    if (isPostBookingMode) {
        appendMessage(text, 'user');
        chatHistory.push({ role: 'user', content: text });
        const lower = text.toLowerCase().trim();

        // ─ Fuzzy typo helper (reschedule, cancel tolerate misspelling) ────────────
        function fuzzyMatch(word, target) {
            if (word.includes(target) || target.includes(word)) return true;
            let ti = 0, matched = 0;
            for (let c of word) {
                if (ti < target.length && c === target[ti]) { matched++; ti++; }
            }
            return matched / target.length >= 0.75;
        }
        const words = lower.split(/\s+/);

        // ─ Detect greeting / thanks — no action needed ──────────────────────
        const isGreeting = /^(hi|hello|hey|thanks|thank you|ok|okay|great|cool|got it|noted|perfect|sounds good|nice|awesome|sure|alright|yep|yup|yes|no problem|np)\W*$/.test(lower);
        if (isGreeting) {
            setTimeout(() => appendMessage("You're all set! See you at the meeting 🔥", 'bot'), 400);
            return;
        }

        // ─ Detect intents ────────────────────────────────────────────────────
        const wantsLink =
            lower.includes('link') || lower.includes('meet') ||
            lower.includes('where') || lower.includes('send') ||
            lower.includes('url') || lower.includes('join');

        const wantsReschedule =
            words.some(w => fuzzyMatch(w, 'reschedule')) ||
            lower.includes('change') || lower.includes('different time') ||
            lower.includes('new time') || lower.includes('postpone') ||
            lower.includes('prepone') || lower.includes('move meeting') ||
            lower.includes('shift meeting');

        const wantsCancel =
            words.some(w => fuzzyMatch(w, 'cancel')) ||
            lower.includes('delete meeting') || lower.includes('remove meeting');

        // ─ Stage: waiting for reschedule time ──────────────────────────────
        if (postBookingStage === 'awaiting_reschedule_time') {
            postBookingStage = null;
            await handleClientReschedule(text);
            return;
        }

        // ─ If reschedule keyword contains a time in the same message, act immediately ─
        if (wantsReschedule) {
            // Check if a time is already embedded (digit + am/pm or named day)
            const hasTime = /\d/.test(lower) || /(monday|tuesday|wednesday|thursday|friday|tomorrow|today)/.test(lower);
            if (hasTime) {
                await handleClientReschedule(text);
            } else {
                postBookingStage = 'awaiting_reschedule_time';
                setTimeout(() => appendMessage(
                    'Sure! What new day and time works for you? (Mon–Fri, 5:30–9:30 PM IST)',
                    'bot'
                ), 400);
            }
            return;
        }

        if (wantsLink) {
            const bd = getBookedData();
            setTimeout(() => {
                if (bd?.meetLink) {
                    appendMessage(`🔗 Here's your Google Meet link: <a href="${bd.meetLink}" target="_blank">${bd.meetLink}</a>`, 'bot');
                } else {
                    appendMessage('Hardik will send your Meet link directly to your saved contact.', 'bot');
                }
            }, 400);
            return;
        }

        if (wantsCancel) {
            await handleClientCancel();
            return;
        }

        // ─ Fallback hint (only if genuinely unclear) ─────────────────────────
        setTimeout(() => appendMessage(
            `I can help with:\n• "Send link" — get your Meet link\n• "Reschedule [day time]" — change the meeting\n• "Cancel" — cancel this meeting`,
            'bot'
        ), 400);
        return;
    }

    // ─── NORMAL MODE ─────────────────────────────────────────────────────────
    appendMessage(text, 'user');
    chatHistory.push({ role: 'user', content: text });
    await fetchAgentResponse();
}

// ─── Handle client-initiated reschedule (validate + update calendar) ───────────
async function handleClientReschedule(timeText) {
    const bd = getBookedData();

    // Parse the new time
    let parsedISO = null;
    try {
        const parseRes = await fetch('/api/parse-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: timeText })
        });
        const parseData = await parseRes.json();
        if (parseData.valid) parsedISO = parseData.iso;
        if (!parseData.valid) {
            setTimeout(() => appendMessage(
                parseData.message || "That time is outside Hardik's availability. He's free Mon–Fri, 5:30–9:30 PM IST only.",
                'bot'
            ), 400);
            return;
        }
    } catch(e) {
        // If parse-time endpoint not available, fall back to notify only
        await notifyRescheduleRequest(timeText);
        setTimeout(() => appendMessage(
            `📌 Got it! Hardik has been notified you'd like to reschedule to "${timeText}". He'll confirm on your saved contact.`,
            'bot'
        ), 400);
        return;
    }

    // Attempt the actual calendar reschedule
    appendMessage('⏳ Updating your calendar event...', 'bot');
    try {
        const reschedRes = await fetch('/api/client-reschedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fingerprint: generateFingerprint(),
                newSlotISO: parsedISO,
                eventId: bd?.eventId || ''
            })
        });
        const reschedData = await reschedRes.json();

        if (!reschedRes.ok) {
            setTimeout(() => appendMessage(
                reschedData.message || "Couldn't update that time. Hardik has been notified and will confirm on your contact.",
                'bot'
            ), 300);
            await notifyRescheduleRequest(timeText);
            return;
        }

        // Update localStorage with new eventId and time
        const fp = generateFingerprint();
        const stored = JSON.parse(localStorage.getItem('kai_booked_' + fp) || '{}');
        stored.data.eventId = reschedData.eventId || stored.data.eventId;
        stored.data.meetLink = reschedData.meetLink || stored.data.meetLink;
        localStorage.setItem('kai_booked_' + fp, JSON.stringify(stored));

        const istLabel = new Date(parsedISO).toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'
        });

        setTimeout(() => appendMessage(
            `✅ Done! Your meeting is moved to <b>${istLabel} IST</b>.\n🔗 Meet link: <a href="${reschedData.meetLink}" target="_blank">${reschedData.meetLink}</a>`,
            'bot'
        ), 300);

    } catch(e) {
        await notifyRescheduleRequest(timeText);
        setTimeout(() => appendMessage(
            `📌 Hardik has been notified of your reschedule request. He'll confirm on your saved contact.`,
            'bot'
        ), 400);
    }
}

// ─── Handle client-initiated cancel (delete calendar event + reset state) ─────
async function handleClientCancel() {
    const bd = getBookedData();
    appendMessage('⏳ Cancelling your meeting...', 'bot');

    // Call server to delete event & notify Hardik
    try {
        await fetch('/api/client-cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fingerprint: generateFingerprint(),
                eventId: bd?.eventId || '',
                clientName: bd?.clientName || 'Client'
            })
        });
    } catch(e) {
        console.warn('[handleClientCancel] API call failed:', e);
    }

    // Clear all localStorage keys for this fingerprint
    const fp = generateFingerprint();
    localStorage.removeItem('kai_booked_' + fp);
    localStorage.removeItem('kai_msgs_' + fp);
    localStorage.removeItem('kai_chat_' + fp);
    sessionStorage.clear();

    // Reset all in-memory state — no page reload needed
    setTimeout(() => {
        isPostBookingMode = false;
        postBookingStage = null;
        contactCardSubmitted = false;
        chatHistory = [];
        savedMessages = [];

        // Clear the messages container
        messagesContainer.innerHTML = '';

        // Show confirmation then a fresh greeting
        appendMessage('✅ Meeting cancelled. Starting fresh — say hi whenever you\'re ready!', 'bot');
        inputField.placeholder = 'Message...';
    }, 600);
}


async function handleSend() {
    const text = inputField.value.trim();
    if (!text || isAgentTyping) return;

    if (!clientName && chatHistory.length <= 2) {
        clientName = text.split(" ").slice(-1)[0]; 
    }
    inputField.value = '';

    await sendMessage(text);
}

async function fetchAgentResponse() {
    isAgentTyping = true;
    typingIndicator.style.display = 'flex';
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
        const res = await fetch('/api/agent-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: chatHistory, sessionId })
        });

        if (!res.ok) throw new Error('API Error');

        const data = await res.json();
        
        let reply = data.reply || "Internal matrix error.";
        
        let displayText = reply;
        let showCard = false;

        if (displayText.includes('SHOW_CONTACT_CARD')) {
            displayText = displayText.replace('SHOW_CONTACT_CARD', '').trim();
            showCard = true;
        }

        // Strip any SHOW_CONFIRMATION_CARD tags that leaked into displayText (should be handled server-side)
        if (displayText.includes('SHOW_CONFIRMATION_CARD:')) {
            displayText = displayText.replace(/SHOW_CONFIRMATION_CARD:\{[\s\S]*?\}\s*$/m, '').trim();
        }

        // Get confirmation data (processed server-side in agent-chat.js)
        // Also strip legacy AGENT_SUMMARY_READY if it somehow appears in display text
        if (displayText.includes('AGENT_SUMMARY_READY:')) {
            displayText = displayText.replace(/AGENT_SUMMARY_READY:\{[\s\S]*?\}\s*$/m, '').trim();
        }

        // Loop failsafe: If the AI tried to run both the question and the confirmation synchronously,
        // we strip the confirmation part so the card can operate uninterrupted.
        if (showCard && displayText.includes('Perfect,')) {
            displayText = displayText.split('Perfect,')[0].trim();
        }

        // Bug 3 guard: NEVER show contact card if reply is a time rejection
        // The AI sometimes emits SHOW_CONTACT_CARD even in a rejection message
        const isRejectionReply =
            displayText.toLowerCase().includes("won't work") ||
            displayText.toLowerCase().includes("doesn't work") ||
            displayText.toLowerCase().includes("can you pick") ||
            displayText.toLowerCase().includes("what day works") ||
            displayText.toLowerCase().includes("not valid") ||
            displayText.toLowerCase().includes("invalid") ||
            displayText.toLowerCase().includes("can't book") ||
            displayText.toLowerCase().includes("outside") ||
            displayText.toLowerCase().includes("weekend") ||
            displayText.toLowerCase().includes("in the past");
        if (isRejectionReply) showCard = false;

        // Only show bot message if there's actual text
        if (displayText.length > 0) {
            appendMessage(displayText, 'bot');
            chatHistory.push({ role: 'assistant', content: displayText });
        }

        // Inject card AFTER message text — only on acceptance
        if (showCard && !document.getElementById('kai-contact-card') && !contactCardSubmitted) {
            triggerContactCard();
        }

        // TRIGGER: Confirmation card from AI
        if (data.confirmationData) {
            console.log('[chat] Confirmation data received:', data.confirmationData);
            setTimeout(() => triggerConfirmationCard(data.confirmationData, data.budgetTier), 400);
        }

    } catch (e) {
        console.error(e);
        appendMessage("An error occurred connecting to the backend matrix.", 'bot');
    } finally {
        isAgentTyping = false;
        typingIndicator.style.display = 'none';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function extractClientName() {
  const agentMessages = chatHistory
    .filter(m => m.role === 'assistant')
    .map(m => m.content);
  
  for (const msg of agentMessages) {
    const match = msg.match(/nice to meet you,?\s+([A-Za-z]+)/i);
    if (match) return match[1];
  }
  
  const userMessages = chatHistory
    .filter(m => m.role === 'user')
    .map(m => m.content);
  
  // Skip index 0 because that's the "Hello, I clicked the widget." internal ping
  if (userMessages.length >= 2) {
    // Only use fallback if it's a short string (likely just a name). If long, revert to 'There'
    const nameStr = userMessages[1].trim();
    if (nameStr.length < 30) {
      const parts = nameStr.split(/\s+/);
      const name = parts[parts.length - 1]; // "I am Alex" -> "Alex"
      return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    }
  }
  
  return 'There';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOFT BOOKING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Detect time expression in a string ───────────────────────────────────────
function containsTimeExpression(text) {
    return /\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today|next week)\b/i.test(text) ||
           /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(text) ||
           /\b(half past|quarter past|quarter to)\b/i.test(text) ||
           /\b\d{1,2}\s*:\s*\d{2}\b/.test(text) ||
           /\b\d{1,2}\s*(pm|am)\b/i.test(text);
}

// ─── Render the 3-button confirmation card ────────────────────────────────────
function triggerConfirmationCard(cd, budgetTier) {
    // Only one card at a time
    document.getElementById('kai-confirm-card')?.remove();

    const slot = cd.proposedSlotISO || cd.proposedSlot;
    let istLabel = cd.proposedSlot || 'Chosen time';
    try {
        istLabel = new Date(cd.proposedSlotISO).toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'
        }) + ' IST';
    } catch(e) {}

    const card = document.createElement('div');
    card.className = 'kai-confirm-card';
    card.id = 'kai-confirm-card';
    card.innerHTML = `
        <div class="kai-confirm-title">MEETING REQUEST</div>
        <div class="kai-confirm-detail">CLIENT  <span>${cd.clientName || '—'}</span></div>
        <div class="kai-confirm-detail">TIME    <span>${istLabel}</span></div>
        <div class="kai-confirm-detail">PROJECT <span>${cd.projectTitle || '—'}</span></div>
        <div class="kai-confirm-subtitle">You have 3 reschedules available within 30 minutes of confirming.</div>
        <div class="kai-confirm-btns">
            <button class="kai-confirm-btn fix-now"     id="kai-btn-fixnow">FIX IT NOW — I'M SURE</button>
            <button class="kai-confirm-btn keep-window" id="kai-btn-keepwindow">KEEP WINDOW OPEN</button>
            <button class="kai-confirm-btn cancel-booking" id="kai-btn-softcancel">CANCEL</button>
        </div>
    `;
    appendVNodes(card);

    document.getElementById('kai-btn-fixnow').addEventListener('click', () => onFixNow(cd, budgetTier, slot));
    document.getElementById('kai-btn-keepwindow').addEventListener('click', () => onKeepWindow(cd, budgetTier, slot));
    document.getElementById('kai-btn-softcancel').addEventListener('click', () => onSoftCancel(cd));
}

// ─── Button 1: FIX IT NOW ─────────────────────────────────────────────────────
async function onFixNow(cd, budgetTier, slotISO) {
    document.getElementById('kai-confirm-card')?.remove();
    appendMessage('⏳ Booking your slot now...', 'bot');

    try {
        const bookRes = await fetch('/api/book-meeting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slot: slotISO,
                clientName: cd.clientName,
                clientEmail: cd.clientEmail || '',
                clientContact: cd.clientContact,
                projectTitle: cd.projectTitle,
                sessionId
            })
        });
        const bookData = await bookRes.json();

        if (!bookRes.ok) {
            const returnedSlots = bookData.slots || [];
            appendMessage(bookData.message || "Couldn't lock that slot. Pick another:", 'bot');
            if (returnedSlots.length > 0) setTimeout(() => injectSlotPicker(returnedSlots, cd), 600);
            return;
        }

        const { meetLink, eventId, startTime } = bookData;

        if (meetLink) {
            appendMessage(`🔗 Your Google Meet link: <a href="${meetLink}" target="_blank">${meetLink}</a>`, 'bot');
            const warnEl = document.createElement('div');
            warnEl.className = 'kai-ttl-warning';
            warnEl.textContent = '⚠ This chat will be available for 48 hours only';
            appendVNodes(warnEl);
        }

        // Notify Hardik — MESSAGE 1 (confirmed instantly)
        await notifyOwner({ ...cd, eventId, label: '✅ CONFIRMED INSTANTLY' }, meetLink, startTime || slotISO, budgetTier);

        markAsBooked(cd.clientName, cd.projectTitle, meetLink, eventId, cd.clientContact);
        enterPostBookingMode(cd.clientName, cd.clientContact);

    } catch(e) {
        console.error('[onFixNow] Error:', e);
        appendMessage('Something went wrong. Please try again.', 'bot');
    }
}

// ─── Button 2: KEEP WINDOW OPEN ───────────────────────────────────────────────
async function onKeepWindow(cd, budgetTier, slotISO) {
    document.getElementById('kai-confirm-card')?.remove();
    appendMessage('⏳ Holding your slot...', 'bot');

    // Save soft booking
    try {
        const saveRes = await fetch('/api/soft-booking?action=save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                fingerprint: generateFingerprint(),
                clientName: cd.clientName,
                clientContact: cd.clientContact,
                projectTitle: cd.projectTitle,
                projectDesc: cd.projectDesc || '',
                budgetTier: budgetTier || cd.budgetTier || 'Unknown',
                chosenTime: slotISO
            })
        });
        const saveData = await saveRes.json();

        if (!saveRes.ok) {
            const slots = saveData.slots || [];
            appendMessage(saveData.message || 'That slot just got taken. Pick a new time:', 'bot');
            if (slots.length > 0) setTimeout(() => injectSlotPicker(slots, cd), 600);
            return;
        }
    } catch(e) {
        console.error('[onKeepWindow] Save failed:', e);
        appendMessage('Something went wrong holding the slot. Try again.', 'bot');
        return;
    }

    // Store state
    isSoftWindowMode    = true;
    softRescheduleCount = 0;
    softSessionData     = { ...cd, proposedSlotISO: slotISO, budgetTier };
    inputField.placeholder = 'Type a new time to reschedule...';

    const now = Date.now();
    localStorage.setItem('kai_soft_' + generateFingerprint(), JSON.stringify({
        sessionId, softBookedAt: now, slotISO,
        clientName: cd.clientName, clientContact: cd.clientContact,
        projectTitle: cd.projectTitle, projectDesc: cd.projectDesc || '',
        budgetTier: budgetTier || 'Unknown'
    }));

    // Show confirmation message
    appendMessage(
        `🟡 Your slot is held for 30 minutes.\n` +
        `You can reschedule up to 3 times in this chat.\n` +
        `After 30 minutes (or when you use all reschedules), your meeting is confirmed automatically.`,
        'bot'
    );

    // Start countdown
    startSoftCountdown(now + SOFT_WINDOW_MS);

    // 30-min auto-finalize timer
    softWindowTimer = setTimeout(() => finalizeSoftBooking('timeout'), SOFT_WINDOW_MS);

    // Notify Hardik — MESSAGE 1 (soft booking)
    await notifyOwnerSoft(cd, slotISO, budgetTier, 3);
}

// ─── Button 3: CANCEL (before finalization) ───────────────────────────────────
async function onSoftCancel(cd) {
    document.getElementById('kai-confirm-card')?.remove();

    // Remove from soft-bookings.json
    try {
        await fetch('/api/soft-booking?action=cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
    } catch(e) {}

    // Notify Hardik
    await notifyOwnerSoftCancel(cd?.clientName || 'Client', cd?.clientContact || '');

    clearSoftState();
    appendMessage('Cancelled! No meeting was created. Say hi to start over.', 'bot');
    inputField.placeholder = 'Message...';
}

// ─── Handle incoming messages during soft window ──────────────────────────────
async function handleSoftWindowMessage(text) {
    const lower = text.toLowerCase().trim();

    // Cancel keywords
    const wantsCancel = /\bcancel\b/.test(lower) || lower.includes('stop') || lower.includes('abort');
    if (wantsCancel) {
        await onSoftCancel(softSessionData);
        return;
    }

    // CRITICAL RULE: only count as a reschedule attempt if text contains a time expression
    if (!containsTimeExpression(text)) {
        appendMessage(
            `I can only update the meeting time or cancel it right now.\nType a new time (e.g. "Monday 7 PM") or say "cancel".`,
            'bot'
        );
        return;
    }

    // Validate the new time
    appendMessage('Checking that slot...', 'bot');
    try {
        const parseRes = await fetch('/api/parse-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const parseData = await parseRes.json();

        if (!parseData.valid) {
            // Do NOT reduce count — validation failed
            appendMessage(parseData.message || "That time is outside Hardik's hours. Try Mon–Fri, 5:30–9:30 PM IST.", 'bot');
            return;
        }

        // Update soft booking
        const updateRes = await fetch('/api/soft-booking?action=update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, newTime: parseData.iso })
        });
        const updateData = await updateRes.json();

        if (!updateRes.ok) {
            // Clash or validation error — do NOT reduce count
            appendMessage(updateData.message || 'That slot is taken. Try another time.', 'bot');
            return;
        }

        // Success — count goes up
        softRescheduleCount = updateData.rescheduleCount;
        softSessionData.proposedSlotISO = parseData.iso;

        const remaining = MAX_RESCHEDULES - softRescheduleCount;
        appendMessage(
            `✅ Updated to <b>${parseData.istLabel}</b>.\n${remaining} reschedule${remaining === 1 ? '' : 's'} left.`,
            'bot'
        );

        // Auto-finalize at MAX_RESCHEDULES
        if (softRescheduleCount >= MAX_RESCHEDULES) {
            clearTimeout(softWindowTimer);
            appendMessage('You\'ve used all reschedules. Finalising your booking now!', 'bot');
            await finalizeSoftBooking('reschedule_limit');
        }

    } catch(e) {
        console.error('[handleSoftWindowMessage] Error:', e);
        appendMessage('Something went wrong checking that time. Try again.', 'bot');
    }
}

// ─── Finalize soft booking (timer or reschedule limit) ────────────────────────
async function finalizeSoftBooking(reason) {
    clearSoftCountdown();
    isSoftWindowMode = false;

    appendMessage('⏳ Finalising your booking...', 'bot');

    try {
        const res = await fetch('/api/finalize-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        const data = await res.json();

        if (data.status === 'clash') {
            // Slot was taken at finalize time
            appendMessage("⚠️ That slot just got taken by someone else! Please pick a new time.", 'bot');
            isSoftWindowMode = true; // let them reschedule once more
            return;
        }

        if (data.status === 'confirmed' && data.meetLink) {
            appendMessage(`🔗 Your Google Meet link: <a href="${data.meetLink}" target="_blank">${data.meetLink}</a>`, 'bot');
            const warnEl = document.createElement('div');
            warnEl.className = 'kai-ttl-warning';
            warnEl.textContent = '⚠ This chat will be available for 48 hours only';
            appendVNodes(warnEl);

            const sd = softSessionData || {};
            markAsBooked(sd.clientName, sd.projectTitle, data.meetLink, data.eventId, sd.clientContact);
            clearSoftState();
            enterPostBookingMode(sd.clientName, sd.clientContact);
        }

    } catch(e) {
        console.error('[finalizeSoftBooking] Error:', e);
        appendMessage('Something went wrong finalising. Hardik has been notified.', 'bot');
    }
}

// ─── Countdown bar ────────────────────────────────────────────────────────────
function startSoftCountdown(expiresAt) {
    // Create the bar
    softWindowBarEl = document.createElement('div');
    softWindowBarEl.className = 'kai-soft-window-bar';
    softWindowBarEl.id = 'kai-soft-bar';
    softWindowBarEl.innerHTML = `<span>SLOT HELD — EXPIRES IN</span><span class="kai-countdown" id="kai-soft-countdown">30:00</span>`;
    appendVNodes(softWindowBarEl);

    function tick() {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            clearSoftCountdown();
            return;
        }
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        const el = document.getElementById('kai-soft-countdown');
        if (el) el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    tick();
    softCountdownInterval = setInterval(tick, 1000);
}

function clearSoftCountdown() {
    if (softCountdownInterval) { clearInterval(softCountdownInterval); softCountdownInterval = null; }
    document.getElementById('kai-soft-bar')?.remove();
    softWindowBarEl = null;
}

// ─── Full in-memory soft state reset ─────────────────────────────────────────
function clearSoftState() {
    if (softWindowTimer) { clearTimeout(softWindowTimer); softWindowTimer = null; }
    clearSoftCountdown();
    isSoftWindowMode    = false;
    softRescheduleCount = 0;
    softSessionData     = null;
    localStorage.removeItem('kai_soft_' + generateFingerprint());
}

// ─── Notify Hardik: soft booking held ─────────────────────────────────────────
async function notifyOwnerSoft(cd, slotISO, budgetTier, remaining) {
    let istLabel = slotISO;
    try { istLabel = new Date(slotISO).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST'; } catch(e) {}
    try {
        await fetch('/api/notify-owner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientName: cd.clientName,
                clientContact: cd.clientContact,
                projectTitle: '🟡 SOFT BOOKING — 30 MIN WINDOW OPEN',
                projectDesc: `${cd.projectDesc || cd.projectTitle}\n\nReschedules remaining: ${remaining}`,
                budgetTier: budgetTier || 'Unknown',
                meetLink: '',
                meetingDateTime: istLabel,
                fingerprint: generateFingerprint(),
                eventId: ''
            })
        });
    } catch(e) { console.error('[notifyOwnerSoft] Failed:', e); }
}

// ─── Notify Hardik: soft booking cancelled ────────────────────────────────────
async function notifyOwnerSoftCancel(clientName, clientContact) {
    try {
        await fetch('/api/notify-owner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientName,
                clientContact,
                projectTitle: '❌ SOFT BOOKING CANCELLED',
                projectDesc: `${clientName} cancelled before confirming.`,
                budgetTier: 'Unknown',
                meetLink: '',
                fingerprint: generateFingerprint(),
                eventId: ''
            })
        });
    } catch(e) {}
}

// ─── Restore soft window on page refresh ──────────────────────────────────────
async function checkSoftBookingStatus() {
    const fp = generateFingerprint();
    const raw = localStorage.getItem('kai_soft_' + fp);
    if (!raw) return false;

    let stored;
    try { stored = JSON.parse(raw); } catch { return false; }

    const expiresAt = stored.softBookedAt + SOFT_WINDOW_MS;
    if (Date.now() > expiresAt) {
        // Window expired — finalize
        localStorage.removeItem('kai_soft_' + fp);
        // Fire finalize in background
        fetch('/api/finalize-booking', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: stored.sessionId })
        }).catch(() => {});
        return false;
    }

    // Restore soft window state
    const serverRes = await fetch('/api/soft-booking?action=get', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: stored.sessionId })
    }).catch(() => null);
    if (!serverRes) return false;
    const serverData = await serverRes.json().catch(() => ({}));
    if (serverData.status !== 'soft') return false;

    // Reassign session (critical for finalize to work)
    sessionId = stored.sessionId;
    isSoftWindowMode    = true;
    softRescheduleCount = serverData.rescheduleCount || 0;
    softSessionData     = { ...serverData };

    appendMessage(`Welcome back! Your slot is still held for ${Math.ceil((expiresAt - Date.now()) / 60000)} more minute(s). You have ${MAX_RESCHEDULES - softRescheduleCount} reschedule(s) left.`, 'bot');
    inputField.placeholder = 'Type a new time to reschedule...';
    startSoftCountdown(expiresAt);
    softWindowTimer = setTimeout(() => finalizeSoftBooking('timeout'), expiresAt - Date.now());

    return true;
}

function triggerContactCard() {

    const cardEl = document.createElement('div');
    cardEl.className = 'kai-contact-card';
    cardEl.id = 'kai-contact-card';
    cardEl.innerHTML = `
      <div class="kai-contact-card-title">YOUR DETAILS</div>
      <div class="kai-contact-field">
        <label>NAME</label>
        <div class="kai-contact-value" id="kai-prefilled-name">${extractClientName()}</div>
      </div>
      <div class="kai-contact-field">
        <label>TELEGRAM USERNAME</label>
        <input type="text" id="kai-input-telegram" placeholder="@username" autocomplete="off" />
        <span class="kai-field-hint">Start with @</span>
      </div>
      <div class="kai-contact-field">
        <label>PHONE NUMBER</label>
        <input type="tel" id="kai-input-phone" placeholder="+91 XXXXX XXXXX" autocomplete="tel" />
        <span class="kai-field-hint">Include country code</span>
      </div>
      <div class="kai-contact-note" id="kai-contact-err">Fill at least one contact method</div>
      <button class="kai-contact-submit" id="kai-contact-submit">CONFIRM DETAILS →</button>
    `;
    appendVNodes(cardEl);
    
    document.getElementById('kai-contact-submit').addEventListener('click', async () => {
        let telegram = document.getElementById('kai-input-telegram').value.trim();
        let phone = document.getElementById('kai-input-phone').value.trim();

        // Auto-fix: add @ if missing for telegram
        if (telegram && !telegram.startsWith('@')) {
            telegram = '@' + telegram;
            document.getElementById('kai-input-telegram').value = telegram;
        }

        // Auto-fix: add +91 if phone is 10 digits without country code
        if (phone) {
            const digitsOnly = phone.replace(/\\D/g, '');
            if (digitsOnly.length === 10) {
            phone = '+91' + digitsOnly;
            document.getElementById('kai-input-phone').value = phone;
            } else if (digitsOnly.length > 10 && !phone.startsWith('+')) {
            phone = '+' + digitsOnly;
            document.getElementById('kai-input-phone').value = phone;
            }
        }

        // Validate — at least one required
        const telegramValid = telegram.length >= 4;
        const phoneValid = phone.replace(/\\D/g, '').length >= 10;

        if (!telegramValid && !phoneValid) {
            const card = document.getElementById('kai-contact-card');
            card.classList.add('shake');
            setTimeout(() => card.classList.remove('shake'), 400);
            document.querySelector('.kai-contact-note').textContent = 
            '⚠ Please fill at least one contact method';
            document.querySelector('.kai-contact-note').style.opacity = '1';
            return;
        }

        // Build contact string
        const contactStr = telegram && telegramValid 
            ? telegram 
            : phone;

        // Flag execution to prevent loops
        contactCardSubmitted = true;

        // Remove card from DOM
        document.getElementById('kai-contact-card').remove();

        // Send as user message and continue conversation
        await sendMessage('My contact: ' + contactStr);
    });
}

// ─── Helper: Notify Owner ─────────────────────────────────────────────────────
async function notifyOwner(summaryData, meetLink, startTime, budgetTier) {
    try {
        const fp = generateFingerprint();
        const notifyRes = await fetch('/api/notify-owner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...summaryData,
                budgetTier: budgetTier || 'Unknown',
                meetLink: meetLink || 'Will be sent separately',
                meetingDateTime: startTime || summaryData.proposedSlot || 'TBD',
                fingerprint: fp,
                eventId: summaryData.eventId || ''
            })
        });
        const notifyData = await notifyRes.json();
        console.log('[chat] Notify response:', notifyData);
    } catch (err) {
        console.error('[chat] Notify failed:', err);
    }
}

// ─── Helper: Enter post-booking restricted mode ────────────────────────────────
function enterPostBookingMode(name, contact) {
    isPostBookingMode = true;
    inputField.placeholder = 'Ask for link, reschedule or cancel...';
    setTimeout(() => {
        appendMessage(
            `You’re all set, ${name || 'there'}! 🔥\n\nMeeting confirmed — link is above.\n\n📌 Need to reschedule or cancel? Just tell me here.`,
            'bot'
        );
    }, 900);
}

// ─── Helper: Inject slot picker on clash ─────────────────────────────────────
function injectSlotPicker(slots, summaryData) {
    const pickerEl = document.createElement('div');
    pickerEl.className = 'kai-contact-card';
    pickerEl.id = 'kai-slot-picker';
    pickerEl.innerHTML = `
      <div class="kai-contact-card-title">PICK A NEW SLOT</div>
      ${slots.map((s, i) => `
        <button class="kai-slot-btn" data-iso="${s.iso}" data-label="${s.time}">${s.time}</button>
      `).join('')}
    `;
    appendVNodes(pickerEl);

    pickerEl.querySelectorAll('.kai-slot-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const iso = btn.getAttribute('data-iso');
            const label = btn.getAttribute('data-label');
            pickerEl.remove();
            appendMessage(`I'd like ${label}`, 'user');

            try {
                const bookRes = await fetch('/api/book-meeting', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        slot: iso,
                        clientName: summaryData.clientName,
                        clientEmail: summaryData.clientEmail || '',
                        clientContact: summaryData.clientContact,
                        projectTitle: summaryData.projectTitle,
                        sessionId
                    })
                });
                const bookData = await bookRes.json();

                if (bookRes.status === 409) {
                    appendMessage('That one just got taken too! Hardik will arrange a time on your contact.', 'bot');
                    await notifyOwner(summaryData, '', label, '');
                    markAsBooked(summaryData.clientName, summaryData.projectTitle);
                    enterPostBookingMode(summaryData.clientName, summaryData.clientContact);
                    return;
                }

                if (bookData.meetLink) {
                    appendMessage(`\ud83d\udd17 Your Google Meet link: <a href="${bookData.meetLink}" target="_blank">${bookData.meetLink}</a>`, 'bot');
                }
                await notifyOwner(summaryData, bookData.meetLink || '', bookData.startTime || label, '');
                markAsBooked(summaryData.clientName, summaryData.projectTitle);
                enterPostBookingMode(summaryData.clientName, summaryData.clientContact);

            } catch (e) {
                appendMessage('Something went wrong. Hardik will be in touch directly.', 'bot');
                console.error('[injectSlotPicker] Error:', e);
            }
        });
    });
}

// ─── Client-initiated: Notify Hardik of reschedule request ────────────────────────
async function notifyRescheduleRequest(newTime) {
    const bd = getBookedData();
    try {
        await fetch('/api/notify-owner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientName: bd?.clientName || 'Client',
                clientContact: bd?.clientContact || '',
                projectTitle: '🔄 RESCHEDULE REQUEST',
                projectDesc: `Client is requesting to reschedule their meeting to: "${newTime}"`,
                meetLink: bd?.meetLink || '',
                proposedSlot: newTime,
                fingerprint: generateFingerprint(),
                eventId: bd?.eventId || ''
            })
        });
    } catch (e) {
        console.error('[notifyRescheduleRequest] Failed:', e);
    }
}

// ─── Client-initiated: Notify Hardik of cancellation request ──────────────────────
async function notifyCancelRequest() {
    const bd = getBookedData();
    try {
        await fetch('/api/notify-owner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientName: bd?.clientName || 'Client',
                clientContact: bd?.clientContact || '',
                projectTitle: '❌ CANCELLATION REQUEST',
                projectDesc: `Client has requested to cancel their meeting.`,
                meetLink: bd?.meetLink || '',
                fingerprint: generateFingerprint(),
                eventId: bd?.eventId || ''
            })
        });
    } catch (e) {
        console.error('[notifyCancelRequest] Failed:', e);
    }
}
