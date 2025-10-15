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

// ======== Trips feed ========
(() => {
  const monthContainer = document.getElementById('trip-months');
  if (!monthContainer) return;

  const upcomingContainer = document.getElementById('trip-upcoming');
  const upcomingEmpty = document.getElementById('trip-upcoming-empty');
  const loadMoreButton = document.getElementById('trip-load-more');
  const emptyState = document.getElementById('trip-empty');
  const errorState = document.getElementById('trip-error');

  const upcomingEmptyDefault = upcomingEmpty?.textContent ?? '';

  const PROXY_URL = 'https://hidden-sky-7353.kow-andrew.workers.dev';
  const CAL_ID = 'f436f5c8074c57efc224b32728ece84f9a6b8af5517462471cf4ad9cfb977da8@group.calendar.google.com';
  const ICS_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL_ID)}/public/basic.ics`;

  const parseICSDate = value => {
    if (!value) return null;
    const cleaned = value.trim().split(':').pop();
    if (/^\d{8}$/.test(cleaned)) {
      return new Date(
        Number(cleaned.slice(0, 4)),
        Number(cleaned.slice(4, 6)) - 1,
        Number(cleaned.slice(6, 8))
      );
    }

    const match = cleaned.match(/^(\d{8})T(\d{6})(Z)?$/);
    if (match) {
      const year = Number(cleaned.slice(0, 4));
      const month = Number(cleaned.slice(4, 6)) - 1;
      const day = Number(cleaned.slice(6, 8));
      const hour = Number(cleaned.slice(9, 11));
      const minute = Number(cleaned.slice(11, 13));
      if (match[3]) {
        return new Date(Date.UTC(year, month, day, hour, minute));
      }
      return new Date(year, month, day, hour, minute);
    }

    return new Date(cleaned);
  };

  const parseICS = text => {
    const flat = text.replace(/\r/g, '').replace(/\n[ \t]/g, '');
    const lines = flat.split('\n');
    const events = [];
    let current = null;
    let inEvent = false;

    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') {
        inEvent = true;
        current = {};
        continue;
      }

      if (line === 'END:VEVENT') {
        if (inEvent && current && current.DTSTART) {
          events.push({
            title: current.SUMMARY || '',
            location: current.LOCATION || '',
            description: (current.DESCRIPTION || '').replace(/\\n/g, '\n'),
            url: current.URL || '',
            start: parseICSDate(current.DTSTART),
            end: parseICSDate(current.DTEND)
          });
        }
        inEvent = false;
        current = null;
        continue;
      }

      if (!inEvent || !line) continue;
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).split(';')[0];
      const value = line.slice(idx + 1);
      current[key] = value;
    }

    return events;
  };

  const formatDateRange = (start, end) => {
    if (!start) return '';
    const dateFormatter = new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    const timeFormatter = new Intl.DateTimeFormat('en-AU', {
      hour: 'numeric',
      minute: '2-digit'
    });

    const dayText = dateFormatter.format(start);
    const startTime = timeFormatter.format(start);
    if (!end) {
      return `${dayText} • ${startTime}`;
    }

    const endTime = timeFormatter.format(end);
    if (endTime === startTime) {
      return `${dayText} • ${startTime}`;
    }
    return `${dayText} • ${startTime} – ${endTime}`;
  };

  const createTripCard = event => {
    const card = document.createElement('article');
    card.className = 'trip-card';

    const title = document.createElement('h3');
    title.className = 'trip-title';
    title.textContent = event.title || 'Untitled event';

    const when = document.createElement('p');
    when.className = 'trip-when';
    when.textContent = formatDateRange(event.start, event.end);

    const elements = [title, when];

    if (event.location) {
      const loc = document.createElement('p');
      loc.className = 'trip-loc';
      loc.innerHTML = `<span aria-hidden="true">📍</span><span>${event.location}</span>`;
      loc.querySelectorAll('span')[1].textContent = event.location;
      elements.push(loc);
    }

    let descriptionElement = null;
    let toggleChip = null;

    if (event.description) {
      toggleChip = document.createElement('span');
      toggleChip.className = 'trip-toggle';
      toggleChip.textContent = 'Details';

      descriptionElement = document.createElement('p');
      descriptionElement.className = 'trip-desc';
      descriptionElement.textContent = event.description.trim();
    }

    elements.forEach(el => card.appendChild(el));

    if (toggleChip) {
      card.appendChild(toggleChip);
    }

    if (descriptionElement) {
      card.appendChild(descriptionElement);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-expanded', 'false');

      const toggleExpansion = () => {
        const expanded = !card.classList.contains('expanded');
        card.classList.toggle('expanded', expanded);
        card.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggleChip.textContent = expanded ? 'Hide details' : 'Details';
      };

      card.addEventListener('click', event => {
        if (event.target instanceof HTMLElement && event.target.closest('a')) {
          return;
        }
        toggleExpansion();
      });

      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleExpansion();
        }
      });
    }

    return card;
  };

  const monthFormatter = new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric'
  });
  const INITIAL_MONTHS = 1;

  const sanitizeEvent = event => ({
    ...event,
    title: (event.title || '').trim(),
    location: (event.location || '').trim(),
    description: (event.description || '').trim()
  });

  const buildMonthGroups = events => {
    const groups = [];
    const byKey = new Map();

    events.forEach(event => {
      const year = event.start.getFullYear();
      const month = event.start.getMonth();
      const key = `${year}-${month}`;
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          label: monthFormatter.format(new Date(year, month)),
          events: []
        };
        byKey.set(key, group);
        groups.push(group);
      }
      group.events.push(event);
    });

    groups.forEach(group => {
      group.events.sort((a, b) => b.start - a.start);
    });

    return groups;
  };

  let groupedMonths = [];
  let renderedMonths = 0;

  const updateLoadMoreVisibility = () => {
    if (!loadMoreButton) return;
    const shouldHide = !groupedMonths.length || renderedMonths >= groupedMonths.length;
    if (shouldHide) {
      loadMoreButton.classList.add('hidden');
      loadMoreButton.setAttribute('aria-hidden', 'true');
      loadMoreButton.disabled = true;
      loadMoreButton.blur();
    } else {
      loadMoreButton.classList.remove('hidden');
      loadMoreButton.removeAttribute('aria-hidden');
      loadMoreButton.disabled = false;
    }
  };

  const appendMonthGroup = group => {
    const wrapper = document.createElement('div');
    wrapper.className = 'trip-month';

    const heading = document.createElement('h3');
    heading.className = 'trip-month-title';
    heading.textContent = group.label;

    const grid = document.createElement('div');
    grid.className = 'trips-grid';
    group.events.forEach(event => {
      grid.appendChild(createTripCard(event));
    });

    wrapper.appendChild(heading);
    wrapper.appendChild(grid);
    monthContainer.appendChild(wrapper);
  };

  const showNextMonth = () => {
    if (renderedMonths >= groupedMonths.length) return;
    appendMonthGroup(groupedMonths[renderedMonths]);
    renderedMonths += 1;
    updateLoadMoreVisibility();
  };

  loadMoreButton?.addEventListener('click', () => {
    showNextMonth();
  });

  const renderMonthGroups = groups => {
    monthContainer.innerHTML = '';
    groupedMonths = groups;
    renderedMonths = 0;

    if (!groups.length) {
      emptyState?.classList.remove('hidden');
      errorState?.classList.add('hidden');
      updateLoadMoreVisibility();
      return;
    }

    emptyState?.classList.add('hidden');
    errorState?.classList.add('hidden');

    const initial = Math.min(INITIAL_MONTHS, groups.length);
    for (let i = 0; i < initial; i += 1) {
      appendMonthGroup(groups[i]);
    }
    renderedMonths = initial;
    updateLoadMoreVisibility();
  };

  const renderUpcoming = events => {
    if (!upcomingContainer) return;

    upcomingContainer.innerHTML = '';

    if (!events.length) {
      if (upcomingEmpty) {
        upcomingEmpty.textContent = upcomingEmptyDefault;
        upcomingEmpty.classList.remove('hidden');
      }
      return;
    }

    upcomingEmpty?.classList.add('hidden');
    events.forEach(event => {
      upcomingContainer.appendChild(createTripCard(event));
    });
  };

  const fetchTrips = async () => {
    try {
      const response = await fetch(`${PROXY_URL}?url=${encodeURIComponent(ICS_URL)}`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const icsText = await response.text();
      const events = parseICS(icsText)
        .filter(event => event.start instanceof Date && !Number.isNaN(event.start.valueOf()))
        .map(sanitizeEvent);

      const now = new Date();
      const upcomingEvents = events
        .filter(event => event.start > now)
        .sort((a, b) => a.start - b.start);
      const recentEvents = events
        .filter(event => event.start <= now)
        .sort((a, b) => b.start - a.start);

      renderUpcoming(upcomingEvents);
      const monthGroups = buildMonthGroups(recentEvents);
      renderMonthGroups(monthGroups);
    } catch (error) {
      console.error('Failed to load trips', error);
      if (upcomingContainer) {
        upcomingContainer.innerHTML = '';
      }
      if (upcomingEmpty) {
        upcomingEmpty.textContent = "We couldn't load upcoming trips right now. Please try again later.";
        upcomingEmpty.classList.remove('hidden');
      }
      errorState?.classList.remove('hidden');
      emptyState?.classList.add('hidden');
      groupedMonths = [];
      renderedMonths = 0;
      updateLoadMoreVisibility();
    }
  };

  fetchTrips();
})();

