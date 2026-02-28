import './styles.css';
import { initChat } from './chat.js';

document.addEventListener("DOMContentLoaded", () => {
    // 1. Create Widget Button
    const btn = document.createElement('button');
    btn.id = 'kai-fab';
    btn.innerHTML = 'KAI';
    document.body.appendChild(btn);

    // 2. Create Chat Box
    const chatWindow = document.createElement('div');
    chatWindow.id = 'kai-widget-window';
    chatWindow.className = 'kai-hidden';
    document.body.appendChild(chatWindow);

    let initialized = false;

    document.getElementById('kai-widget-window').addEventListener('wheel', (e) => {
      e.stopPropagation();
    }, { passive: false });

    document.getElementById('kai-widget-window').addEventListener('touchmove', (e) => {
      e.stopPropagation();
    }, { passive: true });

    // Open/Close toggle execution
    btn.addEventListener('click', () => {
        const isHidden = chatWindow.classList.contains('kai-hidden');
        
        if (!isHidden) {
            // Close logic
            chatWindow.classList.add('kai-hidden');
            btn.classList.remove('open');
            btn.innerHTML = 'KAI';
            document.body.classList.remove('kai-chat-open');
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.documentElement.style.overflow = '';
            
            // Audio unpause
            if (window._kaiAudioWasPaused) {
                const audio = document.getElementById('engineSound');
                if (audio) audio.play().catch(() => {});
                window._kaiAudioWasPaused = false;
            }
            // Portrait unlock
            if (window.innerWidth <= 768) {
                try { screen.orientation?.unlock?.(); } catch(e) {}
                document.getElementById('kai-orient-lock')?.remove();
            }
            
        } else {
            // Open logic
            chatWindow.classList.remove('kai-hidden');
            btn.classList.add('open');
            btn.innerHTML = '×';
            document.body.classList.add('kai-chat-open');
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
            document.documentElement.style.overflow = 'hidden';
            
            // Audio mute
            const audio = document.getElementById('engineSound');
            if (audio && !audio.paused) {
                audio.pause();
                window._kaiAudioWasPaused = true;
            }
            
            // Portrait lock overrider
            if (window.innerWidth <= 768) {
                tryLockOrientation();
            }
            
            if (!initialized) {
                initChat(chatWindow);
                initialized = true;
            }
        }
    });
});

async function tryLockOrientation() {
  try {
    if (screen.orientation?.lock) {
      await screen.orientation.lock('portrait');
      return;
    }
  } catch(e) {}
  // CSS fallback for iOS Safari restrictions
  let el = document.getElementById('kai-orient-lock');
  if (!el) {
    el = document.createElement('style');
    el.id = 'kai-orient-lock';
    document.head.appendChild(el);
  }
  el.textContent = `
    @media screen and (orientation: landscape) and (max-width: 900px) {
      #kai-widget-window {
        width: 100vh !important;
        height: 100vw !important;
        transform: rotate(90deg);
        transform-origin: center center;
        position: fixed;
        top: 50%; left: 50%;
        translate: -50% -50%;
      }
    }
  `;
}
