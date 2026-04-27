
const reveals = document.querySelectorAll('.reveal');
const obs = new IntersectionObserver((entries) => {
  entries.forEach((e,i) => {
    if(e.isIntersecting) { setTimeout(()=>e.target.classList.add('visible'), i*70); obs.unobserve(e.target); }
  });
}, {threshold:0.08, rootMargin:'0px 0px -40px 0px'});
reveals.forEach(el => obs.observe(el));

function countUp(el) {
  const target = parseInt(el.dataset.target), suffix = el.dataset.suffix || '', duration = 1600, start = performance.now();
  function ease(t) { return 1 - Math.pow(1-t, 4); }
  function update(now) {
    const p = Math.min((now-start)/duration, 1);
    el.textContent = Math.round(ease(p)*target) + suffix;
    if(p < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}
const cObs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if(e.isIntersecting) { e.target.querySelectorAll('[data-target]').forEach(countUp); cObs.unobserve(e.target); } });
}, {threshold:0.4});
document.querySelectorAll('.ueber-stats').forEach(el => cObs.observe(el));


  // ═══════════════════════════════════════════════════════════
  // IMMOBILIEN – Daten kommen automatisch aus Google Sheets
  // Neue Immobilie hinzufügen: einfach neue Zeile in der
  // Google Tabelle ausfüllen – die Website aktualisiert sich
  // beim nächsten Laden automatisch.
  // ═══════════════════════════════════════════════════════════

  const IMMOBILIEN_API_URL = '/api/immobilien';

  (function() {
    let IMMOBILIEN = [];
    let aktuellerFilter = 'Alle';

    // CSV parsen
    function parseCSV(text) {
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      return lines.slice(1).map((line, i) => {
        // Handles commas inside quoted fields
        const cols = [];
        let current = '';
        let inQuotes = false;
        for (let c of line) {
          if (c === '"') { inQuotes = !inQuotes; }
          else if (c === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
          else { current += c; }
        }
        cols.push(current.trim());
        const obj = { id: i + 1 };
        headers.forEach((h, idx) => { obj[h.toLowerCase()] = (cols[idx] || '').replace(/^"|"$/g, ''); });
        return obj;
      }).filter(o => o.titel);
    }

    function alleTypen() {
      return ['Alle', ...new Set(IMMOBILIEN.map(o => o.typ).filter(Boolean))];
    }

    function renderFilter() {
      const wrap = document.getElementById('immoFilter');
      if (!wrap) return;
      wrap.innerHTML = '';
      alleTypen().forEach(label => {
        const btn = document.createElement('button');
        btn.className = 'immo-filter-btn' + (label === aktuellerFilter ? ' active' : '');
        btn.textContent = label;
        btn.onclick = () => { aktuellerFilter = label; renderFilter(); renderGrid(); setTimeout(updateImmoCarouselButtons, 50); };
        wrap.appendChild(btn);
      });
    }

    // Google Drive Links automatisch umwandeln
    function fixImageUrl(url) {
      if (!url) return '';
      // Format: https://drive.google.com/file/d/FILE_ID/view
      const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (driveMatch) {
        return `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w800`;
      }
      // Format: https://drive.google.com/open?id=FILE_ID
      const openMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (openMatch) {
        return `https://drive.google.com/thumbnail?id=${openMatch[1]}&sz=w800`;
      }
      return url;
    }

    function buildGallery(bildStr, titel) {
      if (!bildStr) return placeholderModal();
      const bilder = bildStr.split(',').map(s => fixImageUrl(s.trim())).filter(Boolean);
      if (bilder.length === 1) {
        return `<img class="immo-modal-img" src="${bilder[0]}" alt="${titel}">`;
      }
      const imgs = bilder.map((src, i) =>
        `<img class="immo-gallery-img" src="${src}" alt="${titel}" style="display:${i===0?'block':'none'}" data-idx="${i}">`
      ).join('');
      const dots = bilder.map((_, i) =>
        `<div class="immo-gallery-dot${i===0?' active':''}" onclick="gallerGoto(${i})"></div>`
      ).join('');
      return `
        <div class="immo-gallery" id="immoGallery">
          ${imgs}
          ${bilder.length > 1 ? `
          <div class="immo-gallery-nav immo-gallery-prev" onclick="galleryNav(-1)">&#8249;</div>
          <div class="immo-gallery-nav immo-gallery-next" onclick="galleryNav(1)">&#8250;</div>
          <div class="immo-gallery-dots">${dots}</div>` : ''}
        </div>`;
    }

    function placeholder() {
      return `<div class="immo-card-img-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </div>`;
    }

    function placeholderModal() {
      return `<div class="immo-modal-img-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1" width="64" height="64"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </div>`;
    }

    function statusColor(status) {
      if (status === 'Verfügbar') return 'var(--green)';
      if (status === 'Reserviert') return 'var(--gold)';
      return '#888';
    }


    function updateImmoCarouselButtons() {
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

    function scrollImmoCarousel(direction) {
      const grid = document.getElementById('immoGrid');
      if (!grid) return;
      const card = grid.querySelector('.immo-card');
      const gap = 24;
      const step = card ? card.getBoundingClientRect().width + gap : grid.clientWidth * 0.85;
      grid.scrollBy({ left: direction * step, behavior: 'smooth' });
      setTimeout(updateImmoCarouselButtons, 350);
    }


    function formatFact(label, value, suffix = '') {
      if (value === null || value === undefined || value === '') return '';
      return `<div class="immo-fact"><span>${label}</span><strong>${value}${suffix}</strong></div>`;
    }

    function preisAnzeige(obj) {
      if (obj.preisText) return obj.preisText;
      if (!obj.preis && obj.preisart === 'auf Anfrage') return 'auf Anfrage';
      if (!obj.preis) return '';
      if (obj.preisart === 'Preis pro m²') return `${obj.preis} €/m²`;
      return `${obj.preis} €`;
    }


    function valueExists(value) {
      return value !== null && value !== undefined && value !== '';
    }

    function fmtM2(value) {
      return valueExists(value) ? `${value} m²` : '';
    }

    function fact(label, value, suffix = '') {
      if (!valueExists(value)) return '';
      return `<div class="immo-card-fact"><span class="immo-card-fact-val">${value}${suffix}</span><span class="immo-card-fact-key">${label}</span></div>`;
    }

    function modalFact(label, value, suffix = '') {
      if (!valueExists(value)) return '';
      return `<div class="immo-modal-fact"><span>${label}</span><strong>${value}${suffix}</strong></div>`;
    }

    function imageFor(obj) {
      if (obj.bild) return fixImageUrl(String(obj.bild).split(',')[0].trim());
      if (Array.isArray(obj.bilder) && obj.bilder.length) return fixImageUrl(obj.bilder[0]);
      return '';
    }

    function preisAnzeige(obj) {
      if (obj.preisText && obj.preisText !== 'null') return obj.preisText;
      if (!valueExists(obj.preis)) return 'auf Anfrage';
      if ((obj.preisart || '').toLowerCase().includes('m²') || (obj.preisart || '').toLowerCase().includes('qm') || (obj.preisart || '').toLowerCase().includes('pro')) {
        return `${obj.preis} €/m²${obj.vermarktungsart === 'Miete' ? ' Miete' : ''}`;
      }
      return `${obj.preis} €${obj.vermarktungsart === 'Miete' ? ' Miete' : ''}`;
    }

    function renderGrid() {
      const grid = document.getElementById('immoGrid');
      if (!grid) return;
      const gefiltert = aktuellerFilter === 'Alle'
        ? IMMOBILIEN
        : IMMOBILIEN.filter(o => o.typ === aktuellerFilter);

      if (gefiltert.length === 0) {
        grid.innerHTML = '<div class="immo-empty">Keine Objekte in dieser Kategorie verfügbar.</div>';
        return;
      }

      grid.innerHTML = gefiltert.map(obj => {
        const img = imageFor(obj);
        const facts = [
          fact('Fläche', obj.flaeche, ' m²'),
          fact('Zimmer', obj.zimmer),
          obj.etage ? fact('Etage', obj.etage) : '',
          fact('Lager', obj.lagerflaeche, ' m²'),
          fact('Teilbar ab', obj.teilbarAb, ' m²')
        ].filter(Boolean).join('');

        return `
        <div class="immo-card reveal visible" onclick="openImmoModal(${obj.id})">
          <div class="immo-card-media">
            ${img
              ? `<img class="immo-card-img" src="${img}" alt="${obj.titel}" loading="lazy">`
              : placeholder()}
            ${obj.status ? `<div class="immo-card-badge" style="background:${statusColor(obj.status)}">${obj.status}</div>` : ''}
          </div>
          <div class="immo-card-body">
            ${obj.typ ? `<div class="immo-card-type">${obj.typ}</div>` : ''}
            <div class="immo-card-title">${obj.titel}</div>
            ${obj.ort ? `<div class="immo-card-location">📍 ${obj.ort}</div>` : ''}
            ${obj.vermarktungsart ? `<div class="immo-card-market">${obj.vermarktungsart}</div>` : ''}
            ${facts ? `<div class="immo-card-facts">${facts}</div>` : ''}
            <div class="immo-card-price">${preisAnzeige(obj)}</div>
          </div>
        </div>`;
      }).join('');

      setTimeout(updateImmoCarouselButtons, 80);
    }

    window.openImmoModal = function(id) {
      const obj = IMMOBILIEN.find(o => o.id === id);
      if (!obj) return;

      const facts = [
        modalFact('Vermarktungsart', obj.vermarktungsart),
        modalFact('Status', obj.status),
        modalFact('Preis', preisAnzeige(obj)),
        modalFact('Fläche', obj.flaeche, ' m²'),
        modalFact('Zimmer', obj.zimmer),
        modalFact('Etage(n)', obj.etage),
        modalFact('Lagerfläche', obj.lagerflaeche, ' m²'),
        modalFact('Teilbar ab', obj.teilbarAb, ' m²')
      ].filter(Boolean).join('');

      const bilderString = Array.isArray(obj.bilder) && obj.bilder.length ? obj.bilder.join(',') : obj.bild;

      document.getElementById('immoModalContent').innerHTML = `
        ${buildGallery(bilderString, obj.titel)}
        <div class="immo-modal-body">
          ${obj.typ ? `<div class="immo-card-type">${obj.typ}</div>` : ''}
          <h3>${obj.titel}</h3>
          ${obj.ort ? `<p class="immo-modal-location">📍 ${obj.ort}</p>` : ''}
          ${facts ? `<div class="immo-modal-facts">${facts}</div>` : ''}
          ${obj.beschreibung ? `<p class="immo-modal-desc">${obj.beschreibung}</p>` : ''}
          <a href="#kontakt" onclick="document.getElementById('immoModal').classList.remove('open');document.body.style.overflow='';" class="immo-modal-cta">Jetzt anfragen</a>
        </div>
      `;
      document.getElementById('immoModal').classList.add('open');
      document.body.style.overflow = 'hidden';
    };

    window.galleryNav = function(dir) {
      const gallery = document.getElementById('immoGallery');
      if (!gallery) return;
      const imgs = gallery.querySelectorAll('.immo-gallery-img');
      const dots = gallery.querySelectorAll('.immo-gallery-dot');
      let current = [...imgs].findIndex(img => img.style.display !== 'none');
      imgs[current].style.display = 'none';
      dots[current].classList.remove('active');
      current = (current + dir + imgs.length) % imgs.length;
      imgs[current].style.display = 'block';
      dots[current].classList.add('active');
    };

    window.gallerGoto = function(idx) {
      const gallery = document.getElementById('immoGallery');
      if (!gallery) return;
      const imgs = gallery.querySelectorAll('.immo-gallery-img');
      const dots = gallery.querySelectorAll('.immo-gallery-dot');
      imgs.forEach((img, i) => { img.style.display = i === idx ? 'block' : 'none'; });
      dots.forEach((dot, i) => { dot.classList.toggle('active', i === idx); });
    };

    document.getElementById('immoClose').onclick = closeModal;
    document.getElementById('immoModal').onclick = function(e) { if (e.target === this) closeModal(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    function closeModal() {
      document.getElementById('immoModal').classList.remove('open');
      document.body.style.overflow = '';
    }

    const immoPrev = document.getElementById('immoPrev');
    const immoNext = document.getElementById('immoNext');
    const immoGridEl = document.getElementById('immoGrid');
    if (immoPrev) immoPrev.addEventListener('click', () => scrollImmoCarousel(-1));
    if (immoNext) immoNext.addEventListener('click', () => scrollImmoCarousel(1));
    if (immoGridEl) immoGridEl.addEventListener('scroll', updateImmoCarouselButtons);
    window.addEventListener('resize', updateImmoCarouselButtons);

    // Lade-Indikator
    const grid = document.getElementById('immoGrid');
    if (grid) grid.innerHTML = '<div class="immo-empty" style="opacity:0.5;">Objekte werden geladen...</div>';

    // Immobilien aus sicherer Notion-API laden
    fetch(IMMOBILIEN_API_URL)
      .then(r => {
        if (!r.ok) throw new Error('API Fehler: ' + r.status);
        return r.json();
      })
      .then(rows => {
        IMMOBILIEN = (rows || []).filter(o => o.titel);
        renderFilter();
        renderGrid();
      })
      .catch(err => {
        console.error('Notion API Fehler:', err);
        if (grid) grid.innerHTML = '<div class="immo-empty">Aktuell sind keine Immobilien verfügbar.</div>';
      });

  })();


  // ── PARALLAX ──
  const heroImg = document.querySelector('.hero-architecture img');
  const creamBgs = document.querySelectorAll('.cream-parallax-bg');

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;

        // Hero parallax
        if (heroImg) {
          heroImg.style.transform = `scale(1.03) translateY(${scrollY * 0.35}px)`;
        }

        // Cream section parallax
        creamBgs.forEach(bg => {
          const section = bg.parentElement;
          const rect = section.getBoundingClientRect();
          const center = rect.top + rect.height / 2 - window.innerHeight / 2;
          bg.style.transform = `translateY(${center * 0.15}px)`;
        });

        ticking = false;
      });
      ticking = true;
    }
  });




// Online-ready safety: CountUp final values if observer is unavailable
document.addEventListener('DOMContentLoaded', () => {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('[data-target]').forEach(el => {
      el.textContent = (el.dataset.target || '') + (el.dataset.suffix || '');
    });
  }
});









/* Immobilien Premium Card + Description Formatting */
(function () {
  const apiUrl = '/api/immobilien';
  let items = [];

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));

  const has = (v) => v !== null && v !== undefined && v !== '' && v !== 'null';

  const statusColor = (status) => {
    if (status === 'Verfügbar') return 'var(--green)';
    if (status === 'Reserviert') return 'var(--gold)';
    if (status === 'Diskret') return 'var(--anthracite)';
    return 'var(--green)';
  };

  const placeholder = () => `
    <div class="immo-card-img-placeholder">
      <svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-8h6v8"/></svg>
    </div>`;

  const imageFor = (obj) => {
    if (obj.bild) return obj.bild;
    if (Array.isArray(obj.bilder) && obj.bilder.length) return obj.bilder[0];
    return '';
  };

  const priceFor = (obj) => has(obj.preisText) ? obj.preisText : 'auf Anfrage';

  const compactFacts = (obj) => {
    const parts = [];
    if (has(obj.flaeche)) parts.push(`${esc(obj.flaeche)} m²`);
    if (has(obj.zimmer)) parts.push(`${esc(obj.zimmer)} Zimmer`);
    if (has(obj.etage)) parts.push(`${esc(obj.etage)}. Etage`);
    return parts.join('<span class="immo-premium-dot">·</span>');
  };

  const modalFact = (label, value, suffix = '') => {
    if (!has(value)) return '';
    return `
      <div class="immo-premium-modal-fact">
        <span>${esc(label)}</span>
        <strong>${esc(value)}${suffix}</strong>
      </div>`;
  };

  function formatDescription(text, isHtml = false) {
    if (!has(text)) return '';

    const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    if (isHtml) {
      return normalized
        .split(/\n\s*\n/g)
        .map(block => block.trim())
        .filter(Boolean)
        .map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`)
        .join('');
    }

    return normalized
      .split(/\n\s*\n/g)
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => {
        const safe = esc(block).replace(/\n/g, '<br>');
        return `<p>${safe}</p>`;
      })
      .join('');
  }

  function renderFilters() {
    const wrap = document.getElementById('immoFilter');
    if (!wrap) return;

    const types = ['Alle', ...new Set(items.map(i => i.typ).filter(Boolean))];

    wrap.innerHTML = types.map((type, i) => `
      <button class="immo-filter-btn${i === 0 ? ' active' : ''}" data-type="${esc(type)}">${esc(type)}</button>
    `).join('');

    wrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCards(btn.dataset.type || 'Alle');
      });
    });
  }

  function renderCards(filter = 'Alle') {
    const grid = document.getElementById('immoGrid');
    if (!grid) return;

    const visible = filter === 'Alle' ? items : items.filter(i => i.typ === filter);

    if (!visible.length) {
      grid.innerHTML = '<div class="immo-empty">Aktuell sind keine Immobilien in dieser Kategorie verfügbar.</div>';
      return;
    }

    grid.innerHTML = visible.map(obj => {
      const img = imageFor(obj);
      const facts = compactFacts(obj);

      return `
        <article class="immo-card immo-premium-card reveal visible" onclick="openImmoModal(${obj.id})">
          <div class="immo-premium-media">
            ${img ? `<img class="immo-card-img" src="${esc(img)}" alt="${esc(obj.titel)}" loading="lazy">` : placeholder()}
            ${has(obj.status) ? `<span class="immo-premium-status" style="background:${statusColor(obj.status)}">${esc(obj.status)}</span>` : ''}
            <div class="immo-premium-price-overlay">
              <span>Preis</span>
              <strong>${esc(priceFor(obj))}</strong>
            </div>
          </div>
          <div class="immo-premium-body">
            ${has(obj.typ) ? `<div class="immo-card-type">${esc(obj.typ)}</div>` : ''}
            <h3>${esc(obj.titel)}</h3>
            ${has(obj.ort) ? `<p class="immo-premium-location">📍 ${esc(obj.ort)}</p>` : ''}
            <div class="immo-premium-meta">
              ${has(obj.vermarktungsart) ? `<span>${esc(obj.vermarktungsart)}</span>` : ''}
              ${facts ? `<span>${facts}</span>` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function gallery(obj) {
    const imgs = Array.isArray(obj.bilder) && obj.bilder.length ? obj.bilder : (obj.bild ? [obj.bild] : []);
    if (!imgs.length) return `<div class="immo-premium-modal-placeholder">${placeholder()}</div>`;
    return `<img class="immo-premium-modal-img" src="${esc(imgs[0])}" alt="${esc(obj.titel)}">`;
  }

  window.openImmoModal = function (id) {
    const obj = items.find(i => Number(i.id) === Number(id));
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
    ].join('');

    const desc = obj.beschreibungHtml ? formatDescription(obj.beschreibungHtml, true) : formatDescription(obj.beschreibung);

    const modal = document.getElementById('immoModal');
    const content = document.getElementById('immoModalContent');
    if (!modal || !content) return;

    content.innerHTML = `
      <div class="immo-premium-modal">
        <button class="immo-premium-close" onclick="document.getElementById('immoModal').classList.remove('open');document.body.style.overflow='';">×</button>
        ${gallery(obj)}
        <div class="immo-premium-modal-body">
          ${has(obj.typ) ? `<div class="immo-card-type">${esc(obj.typ)}</div>` : ''}
          <h3>${esc(obj.titel)}</h3>
          ${has(obj.ort) ? `<p class="immo-modal-location">📍 ${esc(obj.ort)}</p>` : ''}
          ${facts ? `<div class="immo-premium-modal-facts">${facts}</div>` : ''}
          ${desc ? `<div class="immo-premium-description">${desc}</div>` : ''}
          <a href="#kontakt" onclick="document.getElementById('immoModal').classList.remove('open');document.body.style.overflow='';" class="immo-modal-cta">Jetzt anfragen</a>
        </div>
      </div>
    `;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('immoGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="immo-empty" style="opacity:.55;">Objekte werden geladen...</div>';

    fetch(apiUrl)
      .then(r => {
        if (!r.ok) throw new Error('API Fehler ' + r.status);
        return r.json();
      })
      .then(data => {
        items = Array.isArray(data) ? data.filter(i => i && i.titel) : [];
        renderFilters();
        renderCards();
      })
      .catch(err => {
        console.error('Immobilien Premium Fehler:', err);
        grid.innerHTML = '<div class="immo-empty">Aktuell sind keine Immobilien verfügbar.</div>';
      });
  });
})();
