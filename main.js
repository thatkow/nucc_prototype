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
  }
};

const videoObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) {
      video.muted = true;
      ensurePlayback(video);
      video.classList.add('playing');
    } else {
      video.pause();
      video.classList.remove('playing');
    }
  });
}, { threshold: 0.35 });

document.querySelectorAll('.autoplay-video').forEach(video => {
  videoObserver.observe(video);
  if (video.autoplay && video.closest('section')?.getBoundingClientRect().top < window.innerHeight) {
    ensurePlayback(video);
  }
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

// ======== Fetch Upcoming & Past Trips ========
const appConfig = window.appConfig || {};
const environment = (appConfig.environment || '').toLowerCase();
const eventsApiUrl = appConfig.eventsApiUrl || 'http://localhost:3000/api/events';
const useMockEvents = environment === 'dev' && !!appConfig.mockEvents;

const loadEvents = () => {
  if (useMockEvents) {
    return Promise.resolve(appConfig.mockEvents);
  }

  return fetch(eventsApiUrl).then(response => {
    if (!response.ok) {
      throw new Error(`Events request failed with status ${response.status}`);
    }
    return response.json();
  });
};

loadEvents()
  .then(data => {
    const upcomingContainer = document.getElementById('upcoming-events');
    const pastContainer = document.getElementById('past-events');

    const events = data.events || [];
    if (!events.length) {
      upcomingContainer.textContent = 'No events found.';
      pastContainer.textContent = '';
      return;
    }

    const now = new Date();

    const formatDate = dateValue => new Date(dateValue).toLocaleString('en-AU', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    const formatDuration = (start, end) => {
      const ms = new Date(end) - new Date(start);
      const mins = Math.max(Math.round(ms / 60000), 0);
      const hrs = Math.floor(mins / 60);
      const days = Math.floor(hrs / 24);

      if (days >= 1) {
        const remainder = hrs % 24;
        return `${days} day${days > 1 ? 's' : ''}${remainder ? `, ${remainder} hr${remainder > 1 ? 's' : ''}` : ''}`;
      }
      if (hrs >= 1) {
        const remainder = mins % 60;
        return `${hrs} hr${hrs > 1 ? 's' : ''}${remainder ? `, ${remainder} min` : ''}`;
      }
      return `${mins} min`;
    };

    const makeMetaRow = (label, value, className = 'text-sm text-gray-700 mb-1') => {
      const p = document.createElement('p');
      p.className = className;
      const strong = document.createElement('span');
      strong.className = 'font-semibold';
      strong.textContent = `${label}: `;
      p.append(strong, document.createTextNode(value));
      return p;
    };

    const makeCard = event => {
      const card = document.createElement('article');
      card.className = [
        'bg-white rounded-lg shadow-lg p-5 border border-gray-200',
        'hover:shadow-2xl hover:scale-[1.02] transition-all cursor-pointer'
      ].join(' ');

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between mb-2';

      const title = document.createElement('h3');
      title.className = 'text-2xl font-semibold text-gray-900';
      title.textContent = event.title || 'Untitled event';

      const status = document.createElement('span');
      status.className = `px-2 py-1 text-xs font-semibold rounded-full ${event.status === 'CONFIRMED'
        ? 'bg-green-100 text-green-800'
        : 'bg-yellow-100 text-yellow-800'}`;
      status.textContent = event.status || 'TBC';

      header.append(title, status);
      card.appendChild(header);

      if (event.organizer) {
        card.appendChild(makeMetaRow('Organizer', event.organizer));
      }
      card.appendChild(makeMetaRow('Start', formatDate(event.start)));
      card.appendChild(makeMetaRow('End', formatDate(event.end)));
      card.appendChild(makeMetaRow('Duration', formatDuration(event.start, event.end)));

      if (event.location) {
        card.appendChild(makeMetaRow('Location', event.location));
      }

      if (event.description) {
        const description = document.createElement('p');
        description.className = 'text-sm text-gray-600 mt-2 whitespace-pre-line line-clamp-6';
        description.textContent = event.description;
        card.appendChild(description);
      }

      if (event.url) {
        card.addEventListener('click', () => window.open(event.url, '_blank', 'noopener'));
      }

      return card;
    };

    const upcoming = events
      .filter(event => new Date(event.end) >= now)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    const past = events
      .filter(event => new Date(event.end) < now)
      .sort((a, b) => new Date(b.start) - new Date(a.start));

    upcomingContainer.textContent = '';
    pastContainer.textContent = '';

    if (!upcoming.length) {
      upcomingContainer.textContent = 'No upcoming trips.';
    } else {
      upcoming.forEach(event => upcomingContainer.appendChild(makeCard(event)));
    }

    if (!past.length) {
      pastContainer.textContent = 'No past trips.';
    } else {
      past.forEach(event => pastContainer.appendChild(makeCard(event)));
    }
  })
  .catch(error => {
    console.error('Failed to load events:', error);
    document.getElementById('upcoming-events').textContent = 'Unable to load events at this time.';
  });
