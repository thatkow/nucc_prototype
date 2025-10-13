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

// ======== Fetch Upcoming & Past Trips ========
const appConfig = window.appConfig || {};
const environment = (appConfig.environment || '').toLowerCase();
const eventsApiUrl = appConfig.eventsApiUrl || 'http://localhost:3000/api/events';
const useMockEvents = environment === 'dev' && !!appConfig.mockEvents;

const sparseGridRegistry = [];

const focusBackdrop = document.getElementById('event-focus-backdrop');
const focusContent = focusBackdrop ? document.getElementById('event-focus-content') : null;
const focusCloseButton = focusBackdrop ? focusBackdrop.querySelector('[data-focus-close]') : null;
const focusDismissLayer = focusBackdrop ? focusBackdrop.querySelector('[data-focus-dismiss]') : null;
const focusCard = focusBackdrop ? document.getElementById('event-focus-card') : null;

let focusReturnTarget = null;

const isFocusActive = () => focusBackdrop && !focusBackdrop.classList.contains('hidden');

const closeEventFocus = () => {
  if (!isFocusActive()) return;

  focusBackdrop.classList.add('hidden');
  focusBackdrop.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overflow-hidden');

  if (focusReturnTarget && typeof focusReturnTarget.focus === 'function') {
    if (document.contains(focusReturnTarget)) {
      focusReturnTarget.focus();
    }
  }
  focusReturnTarget = null;
};

const formatDate = dateValue => {
  if (!dateValue) return 'TBC';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'TBC';
  return date.toLocaleString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
};

const formatDuration = (start, end) => {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'TBC';
  }
  const ms = endDate - startDate;
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

const buildFocusContent = event => {
  if (!focusContent) return;

  focusContent.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'flex flex-wrap items-start justify-between gap-4';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'space-y-2';

  const title = document.createElement('h2');
  title.className = 'text-3xl font-bold text-gray-900';
  title.id = 'event-focus-title';
  title.textContent = event.title || 'Untitled event';

  const subline = document.createElement('p');
  subline.className = 'text-sm text-gray-600';
  const startLabel = formatDate(event.start);
  const durationLabel = formatDuration(event.start, event.end);
  const sublineParts = [];
  if (startLabel && startLabel !== 'TBC') {
    sublineParts.push(startLabel);
  }
  if (durationLabel && durationLabel !== 'TBC') {
    sublineParts.push(durationLabel);
  }
  subline.textContent = sublineParts.length ? sublineParts.join(' · ') : 'Details coming soon';

  titleWrap.append(title, subline);
  header.appendChild(titleWrap);

  const headerActions = document.createElement('div');
  headerActions.className = 'flex items-center gap-3';

  const status = document.createElement('span');
  status.className = `px-3 py-1 text-xs font-semibold uppercase tracking-wide rounded-full ${event.status === 'CONFIRMED'
    ? 'bg-green-100 text-green-800'
    : 'bg-yellow-100 text-yellow-800'}`;
  status.textContent = event.status || 'TBC';
  headerActions.appendChild(status);

  if (event.url) {
    const actionLink = document.createElement('a');
    actionLink.href = event.url;
    actionLink.target = '_blank';
    actionLink.rel = 'noopener';
    actionLink.className = 'inline-flex items-center gap-2 rounded-full bg-blue-600 px-3 py-1 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white';
    actionLink.setAttribute('aria-label', 'Go to Event (opens in new tab)');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('h-4', 'w-4', 'fill-current');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M22 12c0-5.522-4.477-10-10-10S2 6.478 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987H7.898V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.463h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.891h-2.33v6.987C18.343 21.128 22 16.991 22 12z');
    icon.appendChild(path);

    const label = document.createElement('span');
    label.textContent = 'Go to Event';

    actionLink.append(icon, label);
    headerActions.appendChild(actionLink);
  }

  header.appendChild(headerActions);

  focusContent.appendChild(header);

  const metaGrid = document.createElement('div');
  metaGrid.className = 'grid gap-3 sm:grid-cols-2';
  metaGrid.appendChild(makeMetaRow('Start', formatDate(event.start), 'text-base text-gray-700'));
  metaGrid.appendChild(makeMetaRow('End', formatDate(event.end), 'text-base text-gray-700'));
  metaGrid.appendChild(makeMetaRow('Duration', formatDuration(event.start, event.end), 'text-base text-gray-700'));
  if (event.location) {
    metaGrid.appendChild(makeMetaRow('Location', event.location, 'text-base text-gray-700'));
  }
  if (event.organizer) {
    metaGrid.appendChild(makeMetaRow('Organizer', event.organizer, 'text-base text-gray-700'));
  }
  focusContent.appendChild(metaGrid);

  if (event.description) {
    const description = document.createElement('p');
    description.className = 'whitespace-pre-line text-base leading-relaxed text-gray-700';
    description.textContent = event.description;
    focusContent.appendChild(description);
  }

  if (event.url) {
    const link = document.createElement('a');
    link.href = event.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'inline-flex items-center text-base font-semibold text-yellow-600 hover:text-yellow-700';
    link.textContent = 'Go to Event';
    focusContent.appendChild(link);
  }
};

const openEventFocus = (eventData, invoker) => {
  if (!focusBackdrop || !focusContent || !focusCard) return;

  focusReturnTarget = invoker && typeof invoker.focus === 'function' ? invoker : document.activeElement;

  buildFocusContent(eventData);

  focusCard.scrollTop = 0;
  focusBackdrop.classList.remove('hidden');
  focusBackdrop.setAttribute('aria-hidden', 'false');
  document.body.classList.add('overflow-hidden');

  if (typeof focusCard.focus === 'function') {
    focusCard.focus({ preventScroll: true });
  } else if (focusCloseButton) {
    focusCloseButton.focus();
  }
};

if (focusCloseButton) {
  focusCloseButton.addEventListener('click', () => closeEventFocus());
}

if (focusDismissLayer) {
  focusDismissLayer.addEventListener('click', () => closeEventFocus());
}

if (focusBackdrop) {
  focusBackdrop.addEventListener('click', event => {
    if (!focusCard) return;
    if (!focusCard.contains(event.target)) {
      closeEventFocus();
    }
  });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && isFocusActive()) {
    closeEventFocus();
  }
});

const applySparseGridCentering = () => {
  const isLargeScreen = window.matchMedia('(min-width: 1024px)').matches;

  sparseGridRegistry.forEach(({ container, count }) => {
    if (!container) return;

    if (isLargeScreen && count > 0 && count < 3) {
      const styles = getComputedStyle(container);
      const gap = parseFloat(styles.columnGap) || 24;
      const baseMaxWidth = parseFloat(styles.maxWidth) || 1024;
      const cardWidth = 340;
      const maxContainerWidth = Math.min(cardWidth * count + gap * (count - 1), baseMaxWidth);

      container.style.maxWidth = `${maxContainerWidth}px`;
      container.style.justifyContent = 'center';
      container.style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
    } else {
      container.style.maxWidth = '';
      container.style.justifyContent = '';
      container.style.gridTemplateColumns = '';
    }
  });
};

const registerSparseGrid = (container, count) => {
  if (!container) return;

  const existing = sparseGridRegistry.find(entry => entry.container === container);
  if (existing) {
    existing.count = count;
  } else {
    sparseGridRegistry.push({ container, count });
  }

  applySparseGridCentering();
};

window.addEventListener('resize', applySparseGridCentering);

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

    const makeCard = event => {
      const card = document.createElement('article');
      card.className = [
        'bg-white rounded-lg shadow-lg p-5 border border-gray-200',
        'hover:shadow-2xl hover:scale-[1.01] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-yellow-500'
      ].join(' ');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `View details for ${event.title || 'event'}`);

      const header = document.createElement('div');
      header.className = 'flex flex-wrap items-start justify-between gap-2 mb-3';

      const title = document.createElement('h3');
      title.className = 'text-2xl font-semibold text-gray-900';
      title.textContent = event.title || 'Untitled event';

      const actionWrap = document.createElement('div');
      actionWrap.className = 'flex items-center gap-2';

      const status = document.createElement('span');
      status.className = `px-2 py-1 text-xs font-semibold rounded-full ${event.status === 'CONFIRMED'
        ? 'bg-green-100 text-green-800'
        : 'bg-yellow-100 text-yellow-800'}`;
      status.textContent = event.status || 'TBC';

      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'text-sm font-semibold text-yellow-600 hover:text-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-white rounded px-2 py-1';
      toggleButton.textContent = 'View details';

      actionWrap.append(status, toggleButton);
      header.append(title, actionWrap);
      card.appendChild(header);

      const summary = document.createElement('div');
      summary.className = 'space-y-1';
      summary.appendChild(makeMetaRow('Start', formatDate(event.start)));
      summary.appendChild(makeMetaRow('Duration', formatDuration(event.start, event.end)));
      if (event.location) {
        summary.appendChild(makeMetaRow('Location', event.location));
      }
      card.appendChild(summary);

      const triggerOpen = invoker => openEventFocus(event, invoker);

      toggleButton.addEventListener('click', domEvent => {
        domEvent.stopPropagation();
        triggerOpen(toggleButton);
      });

      card.addEventListener('click', domEvent => {
        if (domEvent.target.closest('button')) {
          return;
        }
        triggerOpen(card);
      });

      card.addEventListener('keydown', domEvent => {
        if (domEvent.key === 'Enter' || domEvent.key === ' ') {
          domEvent.preventDefault();
          triggerOpen(card);
        }
      });

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
    registerSparseGrid(upcomingContainer, upcoming.length);

    if (!past.length) {
      pastContainer.textContent = 'No past trips.';
    } else {
      past.forEach(event => pastContainer.appendChild(makeCard(event)));
    }
    registerSparseGrid(pastContainer, past.length);
  })
  .catch(error => {
    console.error('Failed to load events:', error);
    document.getElementById('upcoming-events').textContent = 'Unable to load events at this time.';
  });
