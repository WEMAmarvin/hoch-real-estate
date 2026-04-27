// Reveal Animation
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveals = document.querySelectorAll('.reveal');
if (!prefersReducedMotion && 'IntersectionObserver' in window) {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('visible'), index * 70);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  reveals.forEach(el => obs.observe(el));
} else {
  reveals.forEach(el => el.classList.add('visible'));
}

// CountUp Animation
function countUp(el) {
  const target = parseInt(el.dataset.target || '0', 10);
  const suffix = el.dataset.suffix || '';
  const duration = prefersReducedMotion ? 1 : 1600;
  const start = performance.now();

  function ease(t) { return 1 - Math.pow(1 - t, 4); }
  function update(now) {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(ease(progress) * target) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

if ('IntersectionObserver' in window) {
  const cObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('[data-target]').forEach(countUp);
        cObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('.ueber-stats').forEach(el => cObs.observe(el));
} else {
  document.querySelectorAll('[data-target]').forEach(el => {
    el.textContent = (el.dataset.target || '') + (el.dataset.suffix || '');
  });
}

// Immobilien aus Notion
(function () {
  const apiUrl = '/api/immobilien';
  let items = [];
  let currentFilter = 'Alle';
  let touchStartX = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[match]));

  const has = (value) => value !== null && value !== undefined && value !== '' && value !== 'null';

  const formatNumber = (value) => {
    if (!has(value)) return '';
    if (typeof value === 'number') {
      return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value);
    }
    const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n)
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n)
      : String(value);
  };

  const statusColor = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized.includes('reserv')) return 'var(--gold)';
    if (normalized.includes('diskret')) return 'var(--anthracite)';
    if (normalized.includes('verkauft') || normalized.includes('vermietet')) return '#777';
    return 'var(--green)';
  };

  const normalizeImageUrl = (url) => {
    if (!url) return '';
    const raw = String(url).trim();

    // Funktioniert als Fallback, langfristig sollten Bilder direkt in Notion hochgeladen werden.
    const driveFile = raw.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveFile) return `https://drive.google.com/thumbnail?id=${driveFile[1]}&sz=w1600`;

    const driveOpen = raw.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
    if (driveOpen) return `https://drive.google.com/thumbnail?id=${driveOpen[1]}&sz=w1600`;

    return raw;
  };

  const imagesFor = (obj) => {
    const rawImages = Array.isArray(obj.bilder) && obj.bilder.length
      ? obj.bilder
      : (obj.bild ? [obj.bild] : []);

    return [...new Set(rawImages.map(normalizeImageUrl).filter(Boolean))];
  };

  const imageFor = (obj) => imagesFor(obj)[0] || '';

  const priceFor = (obj) => has(obj.preisText) ? obj.preisText : 'auf Anfrage';

  const placeholder = () => `
    <div class="immo-card-img-placeholder" aria-label="Kein Bild vorhanden">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
        <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-8h6v8"/>
      </svg>
    </div>`;

  const getCardFacts = (obj) => {
    const candidates = [
      { label: 'Gesamtfläche', value: obj.flaeche, suffix: ' m²', priority: 1 },
      { label: 'Lagerfläche', value: obj.lagerflaeche, suffix: ' m²', priority: 2 },
      { label: 'Teilbar ab', value: obj.teilbarAb, suffix: ' m²', priority: 3 },
      { label: 'Zimmer', value: obj.zimmer, suffix: '', priority: 4 },
      { label: 'Etage', value: obj.etage, suffix: '', priority: 5 }
    ];

    return candidates
      .filter(fact => has(fact.value))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 3);
  };

  const formatFactValue = (fact) => {
    const value = fact.suffix ? formatNumber(fact.value) : esc(fact.value);
    return `${value}${fact.suffix}`;
  };

  const compactFacts = (obj) => getCardFacts(obj)
    .map(fact => `
      <div class="immo-premium-fact-item">
        <span>${esc(fact.label)}</span>
        <strong>${formatFactValue(fact)}</strong>
      </div>
    `)
    .join('');
  const modalFact = (label, value, suffix = '') => {
    if (!has(value)) return '';
    const outputValue = suffix ? formatNumber(value) : esc(value);
    return `
      <div class="immo-premium-modal-fact">
        <span>${esc(label)}</span>
        <strong>${outputValue}${suffix}</strong>
      </div>`;
  };

  function formatDescription(text, isHtml = false) {
    if (!has(text)) return '';
    const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    return normalized
      .split(/\n\s*\n/g)
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => {
        const content = isHtml ? block.replace(/\n/g, '<br>') : esc(block).replace(/\n/g, '<br>');
        return `<p>${content}</p>`;
      })
      .join('');
  }

  function renderFilters() {
    const wrap = document.getElementById('immoFilter');
    if (!wrap) return;

    const types = ['Alle', ...new Set(items.map(item => item.typ).filter(Boolean))];

    wrap.innerHTML = types.map(type => `
      <button class="immo-filter-btn${type === currentFilter ? ' active' : ''}" data-type="${esc(type)}" type="button">${esc(type)}</button>
    `).join('');

    wrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.type || 'Alle';
        renderFilters();
        renderCards();
        setTimeout(updateCarouselButtons, 80);
      });
    });
  }

  function renderCards() {
    const grid = document.getElementById('immoGrid');
    if (!grid) return;

    const visible = currentFilter === 'Alle' ? items : items.filter(item => item.typ === currentFilter);

    if (!visible.length) {
      grid.innerHTML = '<div class="immo-empty">Aktuell sind keine Immobilien in dieser Kategorie verfügbar.</div>';
      updateCarouselButtons();
      return;
    }

    grid.innerHTML = visible.map(obj => {
      const img = imageFor(obj);
      const facts = compactFacts(obj);
      const imageCount = imagesFor(obj).length;

      return `
        <article class="immo-card immo-premium-card reveal visible" data-immo-id="${Number(obj.id)}" role="button" tabindex="0">
          <div class="immo-premium-media">
            ${img ? `<img class="immo-card-img" src="${esc(img)}" alt="${esc(obj.titel)}" loading="lazy" decoding="async">` : placeholder()}
            ${has(obj.status) ? `<span class="immo-premium-status" style="background:${statusColor(obj.status)}">${esc(obj.status)}</span>` : ''}
            ${imageCount > 1 ? `<span class="immo-premium-image-count">${imageCount} Bilder</span>` : ''}
            <div class="immo-premium-price-overlay">
              <span>Preis</span>
              <strong>${esc(priceFor(obj))}</strong>
            </div>
          </div>
          <div class="immo-premium-body">
            ${has(obj.typ) ? `<div class="immo-card-type">${esc(obj.typ)}</div>` : ''}
            <h3 id="immoModalTitle">${esc(obj.titel)}</h3>
            ${has(obj.ort) ? `<p class="immo-premium-location">📍 ${esc(obj.ort)}</p>` : ''}
            ${(has(obj.vermarktungsart) || facts) ? `
              <div class="immo-premium-meta">
                ${has(obj.vermarktungsart) ? `<span class="immo-premium-dealtype">${esc(obj.vermarktungsart)}</span>` : ''}
                ${facts ? `<div class="immo-premium-card-facts">${facts}</div>` : ''}
              </div>` : ''}
          </div>
        </article>`;
    }).join('');

    updateCarouselButtons();
  }

  function gallery(obj) {
    const imgs = imagesFor(obj);
    if (!imgs.length) return `<div class="immo-premium-modal-placeholder">${placeholder()}</div>`;

    const imageSlides = imgs.map((src, index) => `
      <img class="immo-premium-gallery-img${index === 0 ? ' active' : ''}" src="${esc(src)}" alt="${esc(obj.titel)}" data-index="${index}" decoding="async">
    `).join('');

    const dots = imgs.map((_, index) => `
      <button class="immo-premium-gallery-dot${index === 0 ? ' active' : ''}" type="button" onclick="event.stopPropagation(); immoPremiumGalleryGo(${index});" aria-label="Bild ${index + 1} anzeigen"></button>
    `).join('');

    return `
      <div class="immo-premium-gallery" id="immoPremiumGallery">
        ${imageSlides}
        ${imgs.length > 1 ? `
          <button class="immo-premium-gallery-nav prev" type="button" onclick="event.stopPropagation(); immoPremiumGalleryNav(-1);" aria-label="Vorheriges Bild">‹</button>
          <button class="immo-premium-gallery-nav next" type="button" onclick="event.stopPropagation(); immoPremiumGalleryNav(1);" aria-label="Nächstes Bild">›</button>
          <div class="immo-premium-gallery-counter"><span id="immoPremiumGalleryCurrent">1</span> / ${imgs.length}</div>
          <div class="immo-premium-gallery-dots">${dots}</div>
        ` : ''}
      </div>`;
  }

  window.immoPremiumGalleryGo = function(index) {
    const galleryEl = document.getElementById('immoPremiumGallery');
    if (!galleryEl) return;

    const imgs = galleryEl.querySelectorAll('.immo-premium-gallery-img');
    const dots = galleryEl.querySelectorAll('.immo-premium-gallery-dot');
    const counter = document.getElementById('immoPremiumGalleryCurrent');
    if (!imgs.length || !imgs[index]) return;

    imgs.forEach(img => img.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));
    imgs[index].classList.add('active');
    if (dots[index]) dots[index].classList.add('active');
    if (counter) counter.textContent = String(index + 1);
  };

  window.immoPremiumGalleryNav = function(direction) {
    const galleryEl = document.getElementById('immoPremiumGallery');
    if (!galleryEl) return;

    const imgs = [...galleryEl.querySelectorAll('.immo-premium-gallery-img')];
    if (!imgs.length) return;

    const current = Math.max(0, imgs.findIndex(img => img.classList.contains('active')));
    const next = (current + direction + imgs.length) % imgs.length;
    window.immoPremiumGalleryGo(next);
  };

  function closeModal() {
    const modal = document.getElementById('immoModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }

  window.openImmoModal = function(id) {
    const obj = items.find(item => Number(item.id) === Number(id));
    if (!obj) return;

    const facts = [
      modalFact('Vermarktungsart', obj.vermarktungsart),
      modalFact('Status', obj.status),
      modalFact('Preis', priceFor(obj)),
      modalFact('Fläche', obj.flaeche, ' m²'),
      modalFact('Zimmer', obj.zimmer),
      modalFact('Etage(n)', obj.etage),
      modalFact('Lagerfläche', obj.lagerflaeche, ' m²'),
      modalFact('Teilbar ab', obj.teilbarAb, ' m²')
    ].filter(Boolean).join('');

    const description = obj.beschreibungHtml
      ? formatDescription(obj.beschreibungHtml, true)
      : formatDescription(obj.beschreibung, false);

    const modal = document.getElementById('immoModal');
    const content = document.getElementById('immoModalContent');
    if (!modal || !content) return;

    content.innerHTML = `
      <div class="immo-premium-modal">
        ${gallery(obj)}
        <div class="immo-premium-modal-body">
          ${has(obj.typ) ? `<div class="immo-card-type">${esc(obj.typ)}</div>` : ''}
          <h3 id="immoModalTitle">${esc(obj.titel)}</h3>
          ${has(obj.ort) ? `<p class="immo-modal-location">📍 ${esc(obj.ort)}</p>` : ''}
          ${facts ? `<div class="immo-premium-modal-facts">${facts}</div>` : ''}
          ${description ? `<div class="immo-premium-description">${description}</div>` : ''}
          <div class="immo-premium-cta-wrap">
            <a href="#kontakt" onclick="document.getElementById('immoModal').classList.remove('open');document.getElementById('immoModal').setAttribute('hidden','');document.body.style.overflow='';" class="immo-modal-cta">Jetzt anfragen</a>
          </div>
        </div>
      </div>`;

    modal.removeAttribute('hidden');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    modal.querySelector('.immo-modal-inner')?.focus({ preventScroll: true });
  };

  function updateCarouselButtons() {
    const grid = document.getElementById('immoGrid');
    const prev = document.getElementById('immoPrev');
    const next = document.getElementById('immoNext');
    if (!grid || !prev || !next) return;

    const maxScroll = grid.scrollWidth - grid.clientWidth;
    const hasOverflow = maxScroll > 4;
    prev.style.display = next.style.display = hasOverflow ? 'inline-flex' : 'none';
    prev.disabled = !hasOverflow || grid.scrollLeft <= 4;
    next.disabled = !hasOverflow || grid.scrollLeft >= maxScroll - 4;
  }

  function scrollCarousel(direction) {
    const grid = document.getElementById('immoGrid');
    if (!grid) return;

    const card = grid.querySelector('.immo-card');
    const gap = 24;
    const step = card ? card.getBoundingClientRect().width + gap : grid.clientWidth * 0.85;
    grid.scrollBy({ left: direction * step, behavior: 'smooth' });
    setTimeout(updateCarouselButtons, 350);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('immoGrid');
    const modal = document.getElementById('immoModal');
    const closeBtn = document.getElementById('immoClose');
    const prev = document.getElementById('immoPrev');
    const next = document.getElementById('immoNext');

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', event => {
        if (event.target === modal) closeModal();
      });
      modal.addEventListener('touchstart', event => {
        if (!event.target.closest('#immoPremiumGallery')) {
          touchStartX = null;
          return;
        }
        touchStartX = event.changedTouches[0]?.screenX ?? null;
      }, { passive: true });
      modal.addEventListener('touchend', event => {
        if (touchStartX === null || !event.target.closest('#immoPremiumGallery')) return;
        const touchEndX = event.changedTouches[0]?.screenX ?? touchStartX;
        const diff = touchEndX - touchStartX;
        if (Math.abs(diff) > 45) window.immoPremiumGalleryNav(diff > 0 ? -1 : 1);
        touchStartX = null;
      }, { passive: true });
    }

    if (prev) prev.addEventListener('click', () => scrollCarousel(-1));
    if (next) next.addEventListener('click', () => scrollCarousel(1));
    if (grid) {
      grid.addEventListener('scroll', updateCarouselButtons, { passive: true });
      grid.addEventListener('click', event => {
        const card = event.target.closest('[data-immo-id]');
        if (card) window.openImmoModal(card.dataset.immoId);
      });
      grid.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const card = event.target.closest('[data-immo-id]');
        if (!card) return;
        event.preventDefault();
        window.openImmoModal(card.dataset.immoId);
      });
    }
    window.addEventListener('resize', updateCarouselButtons);

    document.addEventListener('keydown', event => {
      const isOpen = document.getElementById('immoModal')?.classList.contains('open');
      if (!isOpen) return;
      if (event.key === 'Escape') closeModal();
      if (event.key === 'ArrowLeft') window.immoPremiumGalleryNav(-1);
      if (event.key === 'ArrowRight') window.immoPremiumGalleryNav(1);
    });

    if (!grid) return;
    grid.innerHTML = '<div class="immo-empty" style="opacity:.55;">Objekte werden geladen...</div>';

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 9000);

    fetch(apiUrl, { signal: controller.signal, headers: { 'Accept': 'application/json' } })
      .then(response => {
        if (!response.ok) throw new Error('API Fehler ' + response.status);
        return response.json();
      })
      .then(data => {
        items = Array.isArray(data) ? data.filter(item => item && item.titel) : [];
        renderFilters();
        renderCards();
      })
      .catch(error => {
        if (error.name !== 'AbortError') console.error('Immobilien konnten nicht geladen werden:', error);
        grid.innerHTML = '<div class="immo-empty">Aktuell sind keine Immobilien verfügbar.</div>';
        updateCarouselButtons();
      })
      .finally(() => window.clearTimeout(timeout));
  });
})();

// Parallax
(function () {
  if (prefersReducedMotion) return;
  const heroImg = document.querySelector('.hero-architecture img');
  const creamBgs = document.querySelectorAll('.cream-parallax-bg');
  let ticking = false;

  window.addEventListener('scroll', () => {
    if (ticking) return;
    requestAnimationFrame(() => {
      const scrollY = window.scrollY;

      if (heroImg) {
        heroImg.style.transform = `scale(1.03) translateY(${scrollY * 0.35}px)`;
      }

      creamBgs.forEach(bg => {
        const section = bg.parentElement;
        const rect = section.getBoundingClientRect();
        const center = rect.top + rect.height / 2 - window.innerHeight / 2;
        bg.style.transform = `translateY(${center * 0.15}px)`;
      });

      ticking = false;
    });
    ticking = true;
  }, { passive: true });
})();
