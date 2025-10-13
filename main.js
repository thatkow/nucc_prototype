// ======== Gradient scroll based on viewport midpoint ========
const sections = document.querySelectorAll("section[data-bg]");
const body = document.body;

const hexToRgb = hex => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const interpolateColor = (a, b, t) =>
  a.map((v, i) => Math.round(v + t * (b[i] - v)));
const rgbToCss = r => `rgb(${r[0]}, ${r[1]}, ${r[2]})`;

window.addEventListener("scroll", () => {
  const scrollMid = window.scrollY + window.innerHeight / 2;

  let current = sections[0];
  let next = sections[0];

  for (let i = 0; i < sections.length; i++) {
    const top = sections[i].offsetTop;
    const bottom = top + sections[i].offsetHeight;
    if (scrollMid >= top && scrollMid < bottom) {
      current = sections[i];
      next = sections[i + 1] || sections[i];
      break;
    }
  }

  const start = current.offsetTop + current.offsetHeight / 2;
  const end = next.offsetTop + next.offsetHeight / 2;

  let rawT = (scrollMid - start) / (end - start);
  let t = Math.min(Math.max((rawT - 0.6) / 0.25, 0), 1);
  t = t * t * (3 - 2 * t);

  const cs = hexToRgb(getComputedStyle(current).getPropertyValue("--bg-start").trim());
  const ce = hexToRgb(getComputedStyle(current).getPropertyValue("--bg-end").trim());
  const ns = hexToRgb(getComputedStyle(next).getPropertyValue("--bg-start").trim());
  const ne = hexToRgb(getComputedStyle(next).getPropertyValue("--bg-end").trim());

  const sBlend = interpolateColor(cs, ns, t);
  const eBlend = interpolateColor(ce, ne, t);

  body.style.background = `linear-gradient(to bottom, ${rgbToCss(sBlend)}, ${rgbToCss(eBlend)})`;
});

// ======== Video autoplay ========
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.play(); e.target.classList.add('playing'); }
    else { e.target.pause(); e.target.classList.remove('playing'); }
  });
}, { threshold: 0.4 });
document.querySelectorAll('.autoplay-video').forEach(v => observer.observe(v));

// ======== Image lightbox ========
const lightbox = document.getElementById('lightbox');
const lightImg = lightbox.querySelector('img');
document.querySelectorAll('.zoomable').forEach(img => {
  img.addEventListener('click', () => {
    lightImg.src = img.src;
    lightbox.style.display = 'flex';
  });
});
lightbox.addEventListener('click', () => { lightbox.style.display = 'none'; lightImg.src = ''; });

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
      upcomingContainer.innerHTML = '<p>No events found.</p>';
      pastContainer.innerHTML = '';
      return;
    }

    const now = new Date();

    const formatDate = d => new Date(d).toLocaleString('en-AU', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    const formatDuration = (start, end) => {
      const ms = new Date(end) - new Date(start);
      const mins = Math.floor(ms / 60000);
      const hrs = Math.floor(mins / 60);
      const days = Math.floor(hrs / 24);
      if (days >= 1) return `${days} day${days > 1 ? 's' : ''}${hrs % 24 ? `, ${hrs % 24} hr` : ''}`;
      if (hrs >= 1) return `${hrs} hr${hrs > 1 ? 's' : ''}${mins % 60 ? `, ${mins % 60} min` : ''}`;
      return `${mins} min`;
    };

    const makeCard = ev => {
      const startStr = formatDate(ev.start);
      const endStr = formatDate(ev.end);
      const duration = formatDuration(ev.start, ev.end);
      const desc = ev.description ? ev.description.replace(/\\n/g, '\n').replace(/\\\\/g, '\\') : '';

      const card = document.createElement('div');
      card.className = `
        bg-white rounded-lg shadow-lg p-5 border border-gray-200 hover:shadow-2xl
        hover:scale-[1.02] transition-all cursor-pointer
      `;
      card.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-2xl font-semibold text-gray-900">${ev.title}</h3>
          <span class="px-2 py-1 text-xs font-semibold rounded-full ${ev.status === 'CONFIRMED'
            ? 'bg-green-100 text-green-800'
            : 'bg-red-100 text-red-800'}">${ev.status}</span>
        </div>
        ${ev.organizer ? `<p class="text-sm text-gray-700 mb-1"><strong>Organizer:</strong> ${ev.organizer}</p>` : ''}
        <p class="text-sm text-gray-700 mb-1"><strong>Start:</strong> ${startStr}</p>
        <p class="text-sm text-gray-700 mb-1"><strong>End:</strong> ${endStr}</p>
        <p class="text-sm text-gray-700 mb-2"><strong>Duration:</strong> ${duration}</p>
        ${ev.location ? `<p class="text-sm text-gray-700 mb-2"><strong>Location:</strong> ${ev.location}</p>` : ''}
        ${desc ? `<p class="text-sm text-gray-600 mt-2 whitespace-pre-line line-clamp-6">${desc}</p>` : ''}
      `;
      if (ev.url) card.addEventListener('click', () => window.open(ev.url, '_blank'));
      return card;
    };

    // Sort newest first
    const upcoming = events.filter(e => new Date(e.end) >= now)
                           .sort((a,b) => new Date(a.start) - new Date(b.start));
    const past = events.filter(e => new Date(e.end) < now)
                       .sort((a,b) => new Date(b.start) - new Date(a.start));

    if (!upcoming.length) {
      upcomingContainer.innerHTML = '<p>No upcoming trips.</p>';
    } else {
      upcoming.forEach(e => upcomingContainer.appendChild(makeCard(e)));
    }

    if (!past.length) {
      pastContainer.innerHTML = '<p>No past trips.</p>';
    } else {
      past.forEach(e => pastContainer.appendChild(makeCard(e)));
    }
  })
  .catch(err => {
    console.error('Failed to load events:', err);
    document.getElementById('upcoming-events').innerHTML =
      '<p>Unable to load events at this time.</p>';
  });

