// Wait for DOM content to load
document.addEventListener("DOMContentLoaded", () => {

// Remove scroll indicator when scrolling starts
window.addEventListener('scroll', () => {
    const ind = document.querySelector('.scroll-indicator');
    if (ind) ind.style.display = 'none';
}, { once: true });

try {
  // Register ScrollTrigger
  gsap.registerPlugin(ScrollTrigger);

  // Initialize Lenis for Smooth Scroll Loop
  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    direction: 'vertical',
    gestureDirection: 'vertical',
    smooth: true,
    mouseMultiplier: 1,
    smoothTouch: false,
    touchMultiplier: 2,
    infinite: false,
  });

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

  const startOverlay = document.getElementById('start-overlay');
  
  if (startOverlay) {
    startOverlay.addEventListener('click', () => {
      // First click unlocks the AudioContext automatically allowing programatic plays
      if (engineSound) {
        engineSound.volume = 0;
        let playPromise = engineSound.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            engineSound.pause();
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
        const ind = document.querySelector('.scroll-indicator');
        if (ind) ind.style.display = 'block';
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

  // --- AUDIO CONTROL TRIGGER ---
  // Triggers exactly on the 3rd text of the intro, lasts until leaving the loop section
  ScrollTrigger.create({
    trigger: "#section-intro",
    start: "top+=140% top", 
    endTrigger: "#section-identity",
    end: "bottom top",
    onEnter: () => {
      // Fades in normally without scrubbing
      if (engineSound && audioContextResumed) {
        engineSound.currentTime = 0; // Starts from the beginning!
        engineSound.play();
        gsap.to(engineSound, { volume: 1, duration: 2, ease: "power1.inOut" });
      }
    },
    onEnterBack: () => {
      // User scrolled back up from projects into the loop section
      if (engineSound && audioContextResumed) {
        engineSound.play();
        gsap.to(engineSound, { volume: 1, duration: 2, ease: "power1.inOut" });
      }
    },
    onLeave: () => {
      // User scrolled past the loop section fully into projects
      if (engineSound && audioContextResumed) {
        gsap.to(engineSound, { volume: 0, duration: 2, ease: "power1.inOut", onComplete: () => engineSound.pause() });
      }
    },
    onLeaveBack: () => {
      // User scrolled all the way back up (past the 3rd text) into the beginning
      if (engineSound && audioContextResumed) {
        gsap.to(engineSound, { volume: 0, duration: 2, ease: "power1.inOut", onComplete: () => {
           engineSound.pause();
           engineSound.currentTime = 0; // reset to beginning for next time
        }});
      }
    },
  });

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

  gsap.to(projectsContainer, {
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
    
    gsap.fromTo(textInner,
      { x: '-120%', opacity: 0 },
      {
        x: '0%', opacity: 1,
        scrollTrigger: {
          trigger: "#section-projects", 
          start: () => `top top-=${i * window.innerWidth - window.innerWidth * 0.5}`,
          end: () => `top top-=${i * window.innerWidth}`,
          scrub: 1,
          invalidateOnRefresh: true
        }
      }
    );

    gsap.to(textInner, {
      x: '120%', opacity: 0,
      scrollTrigger: {
        trigger: "#section-projects", 
        start: () => `top top-=${i * window.innerWidth + window.innerWidth * 0.5}`,
        end: () => `top top-=${(i + 1) * window.innerWidth}`,
        scrub: 1,
        invalidateOnRefresh: true
      }
    });
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
