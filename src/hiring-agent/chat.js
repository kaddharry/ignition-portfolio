let chatHistory = [];
let sessionId = 'sid_' + Math.random().toString(36).substr(2, 9);
let isAgentTyping = false;
let clientName = '';
let contactCardSubmitted = false;

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
  const key = 'kai_booked_' + generateFingerprint();
  return !!sessionStorage.getItem(key);
}

function getBookedData() {
  const key = 'kai_booked_' + generateFingerprint();
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}

function markAsBooked(clientNameVal, projectTitleVal) {
  const fp = generateFingerprint();
  const key = 'kai_booked_' + fp;
  sessionStorage.setItem(key, JSON.stringify({
    bookedAt: new Date().toISOString(),
    clientName: clientNameVal,
    projectTitle: projectTitleVal
  }));
  fetch('/api/record-booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint: fp, clientName: clientNameVal, projectTitle: projectTitleVal })
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
    
    // Spam guard: if already booked, show persistent message and lock input
    if (hasAlreadyBooked()) {
        const bd = getBookedData();
        appendMessage(
            `Hey ${bd?.clientName || 'there'}! You already have a meeting request pending with Hardik for "${bd?.projectTitle || 'your project'}". He'll be in touch soon on your contact. 🔥`,
            'bot'
        );
        inputField.disabled = true;
        inputField.placeholder = 'Meeting already requested...';
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.4';
        return;
    }

    sendInternalGreeting();
}

function appendMessage(text, role) {
    const msgWrapper = document.createElement('div');
    msgWrapper.className = `kai-msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'kai-bubble';
    
    // Simple bolding formatter for agent replies
    bubble.innerHTML = text.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
    
    msgWrapper.appendChild(bubble);
    messagesContainer.appendChild(msgWrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
    appendMessage(text, 'user');
    chatHistory.push({ role: 'user', content: text });
    await fetchAgentResponse();
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

        // Failsafe intercept raw tags in case server-side regex failed or LLM grouped it
        let finalSummaryData = data.summaryData;
        if (displayText.includes('AGENT_SUMMARY_READY:')) {
            const jsonMatch = displayText.match(/AGENT_SUMMARY_READY:(\\{[\\s\\S]*?\\})/);
            if (jsonMatch) {
                try {
                    finalSummaryData = JSON.parse(jsonMatch[1]);
                    displayText = displayText.replace(jsonMatch[0], '').trim();
                } catch(e) {
                    console.error('[chat] Failed to parse summary JSON:', e);
                }
            }
        }

        // Loop failsafe: If the AI tried to run both the question and the confirmation synchronously,
        // we strip the confirmation part so the card can operate uninterrupted.
        if (showCard && displayText.includes('Perfect,')) {
            displayText = displayText.split('Perfect,')[0].trim();
        }

        // Only show bot message if there's actual text
        if (displayText.length > 0) {
            appendMessage(displayText, 'bot');
            chatHistory.push({ role: 'assistant', content: displayText });
        }

        // Inject card AFTER message text
        if (showCard && !document.getElementById('kai-contact-card') && !contactCardSubmitted) {
            triggerContactCard();
        }

        // TRIGGER: Final Summary → Book → Notify → Mark
        if (finalSummaryData) {
            console.log('[chat] Summary data parsed:', finalSummaryData);
            
            (async () => {
                try {
                    // Step 1: Book the meeting in Google Calendar
                    let meetLink = '';
                    let startTime = finalSummaryData.proposedSlot || '';
                    try {
                        const bookRes = await fetch('/api/book-meeting', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                slot: finalSummaryData.proposedSlot,
                                clientName: finalSummaryData.clientName,
                                clientEmail: finalSummaryData.clientEmail || '',
                                clientContact: finalSummaryData.clientContact,
                                projectTitle: finalSummaryData.projectTitle
                            })
                        });
                        const bookData = await bookRes.json();
                        console.log('[chat] Booking result:', bookData);
                        meetLink = bookData.meetLink || '';
                        startTime = bookData.startTime || startTime;
                        if (meetLink) {
                            appendMessage(`🔗 Your Google Meet link: <a href="${meetLink}" target="_blank">${meetLink}</a>`, 'bot');
                        }
                    } catch (bookErr) {
                        console.warn('[chat] Booking failed (calendar not configured?):', bookErr.message);
                    }

                    // Step 2: Notify owner via Telegram
                    const notifyRes = await fetch('/api/notify-owner', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ...finalSummaryData,
                            budgetTier: data.budgetTier || 'Unknown',
                            meetLink: meetLink || 'Will be sent separately',
                            meetingDateTime: startTime
                        })
                    });
                    const notifyData = await notifyRes.json();
                    console.log('[chat] Notify response:', notifyData);

                    // Step 3: Spam prevention — mark this device as booked
                    markAsBooked(finalSummaryData.clientName, finalSummaryData.projectTitle);

                } catch (err) {
                    console.error('[chat] Post-summary pipeline error:', err);
                }
            })();
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


