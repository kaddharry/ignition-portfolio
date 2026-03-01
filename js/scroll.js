import { inject } from '@vercel/analytics';
inject();

// Force native browser systems to abandon scroll history and hard reset to 0,0 on refresh
if (history.scrollRestoration) {
    history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

// Wait for DOM content to load
document.addEventListener("DOMContentLoaded", () => {
// Advanced Idle Scroll Indicator Logic
let scrollTimeout;

const hideIndicator = () => {
    const ind = document.querySelector('.scroll-indicator');
    if (ind && ind.style.opacity !== '0' && ind.style.display !== 'none') {
        gsap.to(ind, { opacity: 0, duration: 0.2, onComplete: () => ind.style.display = 'none' });
    }
};

const showIndicator = () => {
    const ind = document.querySelector('.scroll-indicator');
    const overlay = document.getElementById('start-overlay');
    // Only show if the overlay is gone and user hasn't hit the absolute bottom
    if (ind && overlay && overlay.style.display === 'none' && (window.innerHeight + window.scrollY) < document.body.offsetHeight - 100) {
        ind.style.display = 'block';
        gsap.to(ind, { opacity: 1, duration: 0.8 });
    }
};

window.addEventListener('scroll', () => {
    hideIndicator();
    clearTimeout(scrollTimeout);
    // 30 seconds idle timeout limit
    scrollTimeout = setTimeout(showIndicator, 30000); 
});

try {
  // Register ScrollTrigger
  gsap.registerPlugin(ScrollTrigger);

  // Initialize Lenis for Smooth Scroll Loop
  const lenis = new Lenis({
    duration: 1.4, // Slightly longer smoothing duration intercepts erratic wheel jumps
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    direction: 'vertical',
    gestureDirection: 'vertical',
    smooth: true,
    mouseMultiplier: 0.5, // Aggressively strictly throttle desktop scroll wheel speeds
    smoothTouch: false,
    touchMultiplier: 0.8, // Radically limit mobile thumb speed throwing
    infinite: false,
  });

  // HARD LOCK: Prevent ANY scrolling natively until they clear the Start Engine sequence
  lenis.stop();
  document.body.style.overflow = "hidden"; // Backup interceptor

  // Sync Lenis with GSAP ScrollTrigger
  lenis.on('scroll', ScrollTrigger.update);

  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  // Audio setup
  const engineSound = document.getElementById('engineSound');
  let audioContextResumed = false;
  let audioCtx, gainNode;

  // iOS Hardware Override Proxy
  const audioProxy = {
      get volume() { return gainNode ? gainNode.gain.value : engineSound.volume; },
      set volume(v) { 
          engineSound.volume = v; // PC
          if(gainNode) gainNode.gain.value = v; // iOS Master Mixer Override
      }
  };

  // Sound Toggle Configuration
  const soundBtn = document.getElementById('sound-toggle');
  let isManuallyMuted = false;

  if (soundBtn) {
      soundBtn.addEventListener('click', () => {
          isManuallyMuted = !isManuallyMuted;
          if (isManuallyMuted) {
              soundBtn.textContent = 'SOUND OFF';
              soundBtn.classList.add('muted');
              if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(()=>{});
              else engineSound.muted = true;
          } else {
              soundBtn.textContent = 'SOUND ON';
              soundBtn.classList.remove('muted');
              if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
              else engineSound.muted = false;
          }
      });
  }

  const startOverlay = document.getElementById('start-overlay');
  
  if (startOverlay) {
    startOverlay.addEventListener('click', () => {
      if (engineSound) {
        engineSound.muted = true; // Hard-mute silences the initial Safari autoplay pop
        let playPromise = engineSound.play();
        
        if (playPromise !== undefined) {
          playPromise.then(() => {
            engineSound.pause();
            engineSound.currentTime = 0;
            engineSound.muted = false; // Restore stream capabilities
            
            // Instantiate digital AudioContext mixer exactly here
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if(!audioCtx && AudioContext) {
                    audioCtx = new AudioContext();
                    const source = audioCtx.createMediaElementSource(engineSound);
                    gainNode = audioCtx.createGain();
                    source.connect(gainNode);
                    gainNode.connect(audioCtx.destination);
                    gainNode.gain.value = 0; // Initialize at absolute 0
                }
                if (audioCtx && audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
            } catch(e) { console.warn("Web Audio API mixer bypassed", e); }

            audioContextResumed = true;
            finishOverlay();
          }).catch(error => {
            console.warn("Audio autoplay prevented by browser. User interaction needed.", error);
            finishOverlay();
          });
        }
      } else {
         finishOverlay();
      }
    });
  }

  function finishOverlay() {
    gsap.to(startOverlay, { opacity: 0, duration: 0.5, onComplete: () => {
        startOverlay.style.display = 'none';
        
        // UNLOCK SYSTEMS AFTER CLEARING Start Engine Block
        lenis.start();
        document.body.style.overflow = "";
        
        if (soundBtn) soundBtn.style.display = 'block';

        const ind = document.querySelector('.scroll-indicator');
        if (ind) {
           ind.style.opacity = '0';
           ind.style.display = 'block';
           gsap.to(ind, { opacity: 1, duration: 1 });
        }
        
        // Start the idle timer immediately
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(showIndicator, 30000);
    }});
  }

  // ----------------------------------------------------------------------
  // SECTION 1: INTRO TEXT ANIMATIONS
  // ----------------------------------------------------------------------
  
  // Create a master timeline for the 200vh section so we don't calculate raw top/bottom strings.
  let introTl = gsap.timeline({
    scrollTrigger: {
      trigger: "#section-intro",
      start: "top top",
      end: "bottom top", // 200vh tall
      pin: ".intro-text__sequence",
      pinSpacing: false,
      scrub: 1
    }
  });

  // Since it's scrub: 1, timelines act sequentially
  // Text 1
  introTl.fromTo('#intro-text-1', {y:'120%', opacity:0}, {y:'0%', opacity:1, duration:1, ease: "power1.out"})
         .to('#intro-text-1', {opacity:1, duration:0.5}) // Hold
         .to('#intro-text-1', {y:'-120%', opacity:0, duration:1, ease: "power1.in"})
  // Text 2
  introTl.fromTo('#intro-text-2', {y:'120%', opacity:0}, {y:'0%', opacity:1, duration:1, ease: "power1.out"}, "-=0.2")
         .to('#intro-text-2', {opacity:1, duration:0.5})
         .to('#intro-text-2', {y:'-120%', opacity:0, duration:1, ease: "power1.in"})
  // Text 3
  introTl.fromTo('#intro-text-3', {y:'120%', opacity:0}, {y:'0%', opacity:1, duration:1, ease: "power1.out"}, "-=0.2")
         .to('#intro-text-3', {opacity:1, duration:0.5})
         .to('#intro-text-3', {y:'-120%', opacity:0, duration:1, ease: "power1.in"});

  // ----------------------------------------------------------------------
  // SECTION 2: CANVAS IMAGE SEQUENCE (Replaces buggy video)
  // ----------------------------------------------------------------------
  const canvas = document.getElementById('hero-lightpass');
  const sectionVideo = document.getElementById('section-video');
  const context = canvas.getContext("2d");

  // Base canvas resolution (Change if you export 4K or 720p)
  canvas.width = 1920;
  canvas.height = 1080;

  const frameCount = 396; // <--- Change this to however many images you export!
  
  // Maps _MConverter.eu_engine-1.jpg to _MConverter.eu_engine-396.jpg
  const currentFrame = index => (
    `images/frames/_MConverter.eu_engine-${index + 1}.jpg`
  );

  const images = [];
  const playhead = { frame: 0 };

  for (let i = 0; i < frameCount; i++) {
    const img = new Image();
    img.src = currentFrame(i);
    images.push(img);
  }

  images[0].onload = render;

  function render() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const img = images[playhead.frame];
    
    if (!img || !img.complete || img.naturalWidth === 0) return;

    // Simulate "object-fit: cover" for Canvas natively
    const canvasRatio = canvas.width / canvas.height;
    const imgRatio = img.width / img.height;
    let w = canvas.width;
    let h = canvas.height;
    let x = 0;
    let y = 0;

    if (imgRatio > canvasRatio) {
       w = canvas.height * imgRatio;
       x = -(w - canvas.width) / 2;
    } else {
       h = canvas.width / imgRatio;
       y = -(h - canvas.height) / 2;
    }

    context.drawImage(img, x, y, w, h); 
  }

  ScrollTrigger.create({
    trigger: sectionVideo,
    start: "top top",
    end: "bottom top",
    scrub: 1, // Change to 0.5 or 0 for faster/tighter tracking
    onUpdate: (self) => {
       playhead.frame = Math.min(frameCount - 1, Math.floor(self.progress * frameCount));
       requestAnimationFrame(render);
    }
  });

  // Audio trigger relocated below to account for pin-spacer math

  // Video Texts master timeline
  let videoTextTl = gsap.timeline({
    scrollTrigger: {
      trigger: sectionVideo,
      start: "top top",
      end: "bottom top",
      scrub: 1
    }
  });

  // Sequence 4 text elements over 700vh area
  videoTextTl.fromTo('#v-text-1', {y:'120%', opacity:0}, {y:'0%', opacity:1, duration:1})
             .to('#v-text-1', {opacity:1, duration:0.5})
             .to('#v-text-1', {y:'-120%', opacity:0, duration:1})
             
             .fromTo('#v-text-2', {y:'120%', opacity:0}, {y:'0%', opacity:1, duration:1})
             .to('#v-text-2', {opacity:1, duration:0.5})
             .to('#v-text-2', {y:'-120%', opacity:0, duration:1})
             
             .fromTo('#v-text-3', {y:'120%', opacity:0}, {y:'0%', opacity:1, duration:1})
             .to('#v-text-3', {opacity:1, duration:0.5})
             .to('#v-text-3', {y:'-120%', opacity:0, duration:1})
             
             .fromTo('#v-text-4', {y:'120%', opacity:0}, {y:'0%', opacity:1, duration:1})
             .to('#v-text-4', {opacity:1, duration:0.5})
             .to('#v-text-4', {y:'-120%', opacity:0, duration:1});

  // ----------------------------------------------------------------------
  // SECTION 3: IDENTITY REVEAL
  // ----------------------------------------------------------------------
  gsap.to(".identity-content", {
    opacity: 1,
    scrollTrigger: {
      trigger: "#section-identity",
      start: "top 60%", 
      end: "center center",
      scrub: 1
    }
  });

  // ----------------------------------------------------------------------
  // SECTION 4: HORIZONTAL PROJECTS SCROLL
  // ----------------------------------------------------------------------
  const projectsContainer = document.getElementById("projects-container");
  const projectPanels = gsap.utils.toArray(".project-panel");

  // Calculate the total horizontal movement distance based on panels
  const getHorizontalDistance = () => -(projectsContainer.scrollWidth - window.innerWidth);

  const horizontalTween = gsap.to(projectsContainer, {
    x: getHorizontalDistance,
    ease: "none",
    scrollTrigger: {
      trigger: "#section-projects",
      start: "top top",
      end: () => "+=" + projectsContainer.scrollWidth, 
      pin: true,
      scrub: 1,
      invalidateOnRefresh: true, 
    }
  });

  // Text entering effect inside each panel as they come into view horizontally
  projectPanels.forEach((panel, i) => {
    const textInner = panel.querySelector(".project-info-inner");
    
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: panel,
        containerAnimation: horizontalTween,
        start: "left 85%", // Starts when left edge enters viewport
        end: "right 15%",  // Finishes when right edge leaves viewport
        scrub: 1
      }
    });

    if (i === 0) {
      // First project is beautifully locked onscreen at start
      gsap.set(textInner, { x: '0vw', opacity: 1 });
      
      // Hold frame
      tl.to(textInner, { x: '0vw', opacity: 1, duration: 3 });
      
      // Exit frame
      tl.to(textInner, { x: '-20vw', opacity: 0, duration: 1, ease: "power1.in" });

    } else {
      // Enter frame
      tl.fromTo(textInner,
        { x: '20vw', opacity: 0 },
        { x: '0vw', opacity: 1, duration: 1, ease: "power1.out" }
      );
      
      // Hold frame (Stays stable in center of screen)
      tl.to(textInner, { x: '0vw', opacity: 1, duration: 2 });
      
      // Exit frame
      tl.to(textInner, { x: '-20vw', opacity: 0, duration: 1, ease: "power1.in" });
    }

    // Toggle active class for Mobile Color/Tilt effect flawlessly based on physical center
    ScrollTrigger.create({
      trigger: panel,
      containerAnimation: horizontalTween,
      start: "left center",
      end: "right center",
      toggleClass: { targets: panel, className: "is-active" }
    });
  });

  // --- AUDIO CONTROL TRIGGER (Relocated and Re-engineered) ---
  
  // 1. Initial Start Hook ("AN ENGINEERING MINDSET" boundary)
  ScrollTrigger.create({
    trigger: "#section-intro",
    start: "top+=48% top", 
    onEnter: () => {
      if (engineSound && audioContextResumed) {
         if (engineSound.paused) {
             engineSound.currentTime = 0;
             engineSound.play();
         }
         audioProxy.volume = 0; // Force baseline
         gsap.to(audioProxy, { volume: 1, duration: 2.5, ease: "power1.out" });
      }
    },
    onLeaveBack: () => {
      if (engineSound && audioContextResumed) {
         gsap.to(audioProxy, { volume: 0, duration: 2.5, onComplete: () => {
             engineSound.pause();
             engineSound.currentTime = 0;
         }});
      }
    }
  });

  // 2. Dynamic Exit Fader Hook (About Section / "ENGINEERED FOR PERFECTION")
  // Fires an absolute 2.5-second graceful fade regardless of how fast the user violently scrolls
  ScrollTrigger.create({
    trigger: "#section-about",
    start: "top center", // Begins identically when the block reaches the middle height of screen
    onEnter: () => {
      if (engineSound && audioContextResumed) {
         gsap.to(audioProxy, { volume: 0, duration: 2.5, ease: "power2.out", onComplete: () => {
             engineSound.pause();
         }});
      }
    },
    onLeaveBack: () => {
      if (engineSound && audioContextResumed) {
         if (engineSound.paused) engineSound.play();
         gsap.to(audioProxy, { volume: 1, duration: 2.5, ease: "power2.in" });
      }
    }
  });

  // Debouncing script resize to refresh scrolltrigger mappings
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      ScrollTrigger.refresh();
      // refresh the canvas render on resize
      if(typeof render === 'function') requestAnimationFrame(render);
    }, 250);
  });

} catch(err) {
    const logger = document.getElementById('debug-logger');
    if (logger) {
      logger.style.display = 'block';
      logger.innerHTML += `CATCH ERROR: ${err.message}<br><hr>`;
    }
}
});
