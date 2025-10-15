// ======== Gradient scroll based on viewport midpoint ========
const sections = Array.from(document.querySelectorAll('section[data-bg]'));
const body = document.body;

const hexToRgb = hex => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const interpolateColor = (a, b, t) => a.map((v, i) => Math.round(v + t * (b[i] - v)));
const rgbToCss = rgb => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const colorCache = new WeakMap();
const getSectionColors = section => {
  if (!colorCache.has(section)) {
    const styles = getComputedStyle(section);
    colorCache.set(section, {
      start: hexToRgb(styles.getPropertyValue('--bg-start').trim()),
      end: hexToRgb(styles.getPropertyValue('--bg-end').trim())
    });
  }
  return colorCache.get(section);
};

let gradientScheduled = false;
const updateGradient = () => {
  gradientScheduled = false;
  if (!sections.length) return;

  const scrollMid = window.scrollY + window.innerHeight / 2;

  let currentIndex = 0;
  for (let i = 0; i < sections.length; i++) {
    if (scrollMid >= sections[i].offsetTop) {
      currentIndex = i;
    } else {
      break;
    }
  }

  const current = sections[currentIndex];
  const next = sections[currentIndex + 1] || current;

  const currentCenter = current.offsetTop + current.offsetHeight / 2;
  const nextCenter = next.offsetTop + next.offsetHeight / 2;

  let t = next === current ? 0 : (scrollMid - currentCenter) / (nextCenter - currentCenter);
  t = Math.min(Math.max(t, 0), 1);
  t = t * t * (3 - 2 * t); // smoothstep easing

  const currentColors = getSectionColors(current);
  const nextColors = getSectionColors(next);

  const startBlend = interpolateColor(currentColors.start, nextColors.start, t);
  const endBlend = interpolateColor(currentColors.end, nextColors.end, t);

  body.style.backgroundImage = `linear-gradient(to bottom, ${rgbToCss(startBlend)}, ${rgbToCss(endBlend)})`;
};

const scheduleGradientUpdate = () => {
  if (!gradientScheduled) {
    gradientScheduled = true;
    requestAnimationFrame(updateGradient);
  }
};

window.addEventListener('scroll', scheduleGradientUpdate, { passive: true });
window.addEventListener('resize', scheduleGradientUpdate);
scheduleGradientUpdate();

// ======== Video autoplay ========
const ensurePlayback = video => {
  if (video.dataset.autoplaying === 'true') return;
  video.dataset.autoplaying = 'true';

  const attemptPlay = () => {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  };

  if (video.readyState >= 2) {
    attemptPlay();
  } else {
    video.addEventListener('loadeddata', attemptPlay, { once: true });
    if (typeof video.load === 'function') {
      video.load();
    }
  }
};

const resetAutoplayFlag = video => {
  delete video.dataset.autoplaying;
};

const primeVideo = video => {
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute('muted', '');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  if (!video.preload || video.preload === 'metadata') {
    video.preload = 'auto';
  }
};

const isInViewport = element => {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
};

const videoObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) {
      ensurePlayback(video);
      video.classList.add('playing');
    } else {
      video.pause();
      resetAutoplayFlag(video);
      video.classList.remove('playing');
    }
  });
}, { threshold: 0.2 });

document.querySelectorAll('.autoplay-video').forEach(video => {
  primeVideo(video);
  videoObserver.observe(video);

  if (isInViewport(video)) {
    ensurePlayback(video);
  }

  video.addEventListener('pointerdown', () => ensurePlayback(video), { once: true });
});

// ======== Image lightbox ========
const lightbox = document.getElementById('lightbox');
const lightImg = lightbox.querySelector('img');
document.querySelectorAll('.zoomable').forEach(img => {
  img.addEventListener('click', () => {
    lightImg.src = img.src;
    lightbox.style.display = 'flex';
  });
});
lightbox.addEventListener('click', () => {
  lightbox.style.display = 'none';
  lightImg.src = '';
});

// ======== Smooth in-page anchor scrolling ========
const anchorLinks = Array.from(
  document.querySelectorAll('a[href^="#"]')
).filter(link => {
  const href = link.getAttribute('href');
  return href && href.length > 1 && !link.hasAttribute('data-scroll-ignore');
});

anchorLinks.forEach(link => {
  const targetId = link.getAttribute('href').slice(1);
  const target = document.getElementById(targetId);
  if (!target) return;

  link.addEventListener('click', event => {
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (history.pushState) {
      history.pushState(null, '', `#${targetId}`);
    } else {
      window.location.hash = targetId;
    }
  });
});

