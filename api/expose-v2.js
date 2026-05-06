import PDFDocument from "pdfkit";

export default async function handler(req, res) {
  try {
    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID || "34fa4c6888f080c8b2f0f54e1dd714a5";
    const requestedId = String(req.query.id || "").trim();

    if (!notionToken) return res.status(500).json({ error: "NOTION_TOKEN fehlt." });
    if (!requestedId) return res.status(400).json({ error: "Immobilien-ID fehlt." });

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sorts: [{ timestamp: "created_time", direction: "descending" }] })
    });

    if (!notionRes.ok) {
      const text = await notionRes.text();
      return res.status(notionRes.status).json({ error: "Notion API Fehler", details: text });
    }

    const data = await notionRes.json();

    function findProp(props, names) {
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(props, name)) return props[name];
      }
      return undefined;
    }

    function plain(prop) {
      if (!prop) return "";
      switch (prop.type) {
        case "title": return (prop.title || []).map(t => t.plain_text || "").join("").trim();
        case "rich_text": return (prop.rich_text || []).map(t => t.plain_text || "").join("").trim();
        case "select": return prop.select?.name || "";
        case "multi_select": return (prop.multi_select || []).map(s => s.name).join(", ");
        case "number": return prop.number === null || prop.number === undefined ? "" : String(prop.number);
        case "date": return prop.date?.start || "";
        case "url": return prop.url || "";
        case "email": return prop.email || "";
        case "phone_number": return prop.phone_number || "";
        case "checkbox": return prop.checkbox ? "true" : "";
        default: return "";
      }
    }

    function number(prop) {
      if (!prop) return null;
      if (prop.type === "number") return typeof prop.number === "number" ? prop.number : null;
      const raw = plain(prop);
      if (!raw) return null;
      const normalized = raw.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    }

    function select(prop) {
      if (!prop) return "";
      if (prop.type === "select") return prop.select?.name || "";
      return plain(prop);
    }

    function splitUrls(value) {
      return String(value || "").split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
    }

    function files(prop) {
      if (!prop) return [];
      if (prop.type === "files") {
        return (prop.files || []).map(file => {
          if (file.type === "file") return file.file?.url || "";
          if (file.type === "external") return file.external?.url || "";
          return "";
        }).filter(Boolean);
      }
      if (prop.type === "url") return splitUrls(prop.url);
      if (prop.type === "rich_text" || prop.type === "title") return splitUrls(plain(prop));
      return [];
    }

    function cover(page) {
      if (!page.cover) return "";
      if (page.cover.type === "file") return page.cover.file?.url || "";
      if (page.cover.type === "external") return page.cover.external?.url || "";
      return "";
    }

    function formatNumber(value) {
      if (value === null || value === undefined || value === "") return "";
      return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
    }

    function priceText(preis, preisart, vermarktungsart) {
      const art = String(preisart || "").toLowerCase();
      const vermarktung = String(vermarktungsart || "").toLowerCase();
      const mietSuffix = vermarktung.includes("miete") ? " Miete" : "";
      if (art.includes("anfrage")) return "auf Anfrage";
      if (preis === null || preis === undefined || preis === "") return "auf Anfrage";
      if (art.includes("m²") || art.includes("m2") || art.includes("qm") || art.includes("pro")) {
        return `${formatNumber(preis)} €/m²${mietSuffix}`;
      }
      return `${formatNumber(preis)} €${mietSuffix}`;
    }

    function mapPage(page, index) {
      const p = page.properties || {};
      const titel = plain(findProp(p, ["Titel", "Name"]));
      const ort = plain(findProp(p, ["Ort", "Adresse", "Standort"]));
      const typ = select(findProp(p, ["Typ", "Kategorie"]));
      const vermarktungsart = select(findProp(p, ["Vermarktungsart", "Vermarktung"]));
      const status = select(findProp(p, ["Status"]));
      const preis = number(findProp(p, ["Preis"]));
      const preisart = select(findProp(p, ["Preisart", "Preistyp", "Preis Typ"]));
      const flaeche = number(findProp(p, ["Fläche", "Flaeche"]));
      const zimmer = number(findProp(p, ["Zimmer"]));
      const etageRaw = plain(findProp(p, ["Etage(n)", "Etagen", "Etage"]));
      const etage = String(etageRaw).trim() === "0" ? "Erdgeschoss" : etageRaw;
      const lagerflaeche = number(findProp(p, ["Lagerfläche", "Lagerflaeche"]));
      const teilbarAb = number(findProp(p, ["teilbar ab", "Teilbar ab", "Teilbar Ab"]));
      const beschreibung = plain(findProp(p, ["Beschreibung", "Kurzbeschreibung"]));
      const lage = plain(findProp(p, ["Lage", "Lagebeschreibung"]));
      const ausstattung = plain(findProp(p, ["Ausstattung"]));
      const highlights = plain(findProp(p, ["Highlights", "Highlights auf einen Blick"]));
      const verfuegbarkeit = plain(findProp(p, ["Verfügbarkeit", "Verfuegbarkeit", "Bezugsfrei"]));
      const baujahr = plain(findProp(p, ["Baujahr"]));
      const energie = plain(findProp(p, ["Energie", "Energieausweis"]));
      const objektart = select(findProp(p, ["Objektart"]));
      const nutzung = select(findProp(p, ["Nutzung"]));
      const bilder = [...new Set([
        ...files(findProp(p, ["Bild", "Bilder", "Foto", "Fotos"])),
        cover(page)
      ].filter(Boolean))];

      return {
        id: index + 1,
        notionId: page.id,
        titel,
        ort,
        typ,
        objektart,
        nutzung,
        vermarktungsart,
        status,
        preis,
        preisart,
        preisText: priceText(preis, preisart, vermarktungsart),
        flaeche,
        zimmer,
        etage,
        lagerflaeche,
        teilbarAb,
        verfuegbarkeit,
        baujahr,
        energie,
        beschreibung,
        lage,
        ausstattung,
        highlights,
        bilder
      };
    }

    const items = (data.results || []).map(mapPage).filter(item => item.titel);
    const obj = items.find(item => String(item.notionId) === requestedId || String(item.id) === requestedId);
    if (!obj) return res.status(404).json({ error: "Immobilie nicht gefunden." });

    const safeName = (obj.titel || "Expose").replace(/[^a-z0-9äöüß\- ]/gi, "").replace(/\s+/g, "-").slice(0, 80);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-Expose.pdf"`);

    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, autoFirstPage: true });
    doc.pipe(res);

    const GREEN = "#00424a";
    const GREEN2 = "#13686F";
    const GOLD = "#C8A46B";
    const CREAM = "#F7F4EF";
    const GRAY = "#6b7280";
    const DARK = "#2B2B2B";
    const WHITE = "#ffffff";
    const LIGHT_LINE = "#e7e1d7";

    const W = doc.page.width;
    const H = doc.page.height;

    async function imageBuffer(url) {
      if (!url) return null;
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const type = r.headers.get("content-type") || "";
        if (!type.includes("image") && !url.match(/\.(png|jpe?g)(\?|$)/i)) return null;
        const a = await r.arrayBuffer();
        return Buffer.from(a);
      } catch {
        return null;
      }
    }

    function text(value) {
      return String(value || "").replace(/\r/g, "").trim();
    }

    function truncate(value, max = 900) {
      const v = text(value);
      if (v.length <= max) return v;
      return v.slice(0, max - 1).trim() + "…";
    }

    function imageCover(buffer, x, y, w, h) {
      if (!buffer) {
        doc.save();
        doc.rect(x, y, w, h).fill("#e7e1d7");
        doc.restore();
        return;
      }
      try {
        doc.image(buffer, x, y, { width: w, height: h, fit: [w, h], align: "center", valign: "center" });
      } catch {
        doc.save();
        doc.rect(x, y, w, h).fill("#e7e1d7");
        doc.restore();
      }
    }

    function architecturePattern(opacity = 0.07) {
      doc.save();
      doc.opacity(opacity);
      doc.strokeColor(GRAY).lineWidth(0.6);
      for (let i = -180; i < W + 180; i += 42) {
        doc.moveTo(i, 0).lineTo(i + 250, H).stroke();
      }
      for (let y = 40; y < H; y += 88) {
        doc.roundedRect(W - 210, y, 135, 20, 10).stroke();
        doc.roundedRect(W - 68, y + 18, 95, 16, 8).stroke();
      }
      doc.restore();
    }

    function drawLogoVertical(cx, y, scale = 1) {
      // Based on HOCH vertical mark. Centered around cx.
      const markW = 220 * scale;
      const x = cx - markW / 2;
      doc.save();
      doc.translate(x, y);
      const s = scale;
      doc.fillColor(GREEN2).rect(10*s, 105*s, 20*s, 74*s).fill();
      doc.fillColor("#809597").rect(44*s, 67*s, 24*s, 112*s).fill();
      doc.fillColor("#A5B2B4").rect(78*s, 32*s, 28*s, 147*s).fill();
      doc.fillColor(GOLD).rect(120*s, 0, 32*s, 179*s).fill();
      doc.fillColor(GOLD).rect(164*s, 0, 32*s, 179*s).fill();
      doc.fillColor(GREEN).rect(120*s, 87*s, 76*s, 26*s).fill();
      doc.fillColor("#A5B2B4").rect(210*s, 32*s, 28*s, 147*s).fill();
      doc.fillColor("#809597").rect(250*s, 67*s, 24*s, 112*s).fill();
      doc.fillColor(GREEN2).rect(288*s, 105*s, 20*s, 74*s).fill();
      doc.strokeColor(GOLD).lineWidth(2*s).moveTo(10*s, 179*s).lineTo(308*s, 179*s).stroke();
      doc.fillColor(WHITE).font("Times-Bold").fontSize(58*s).text("HOCH", 0, 190*s, { width: 318*s, align: "center", characterSpacing: 5*s });
      doc.strokeColor(GOLD).lineWidth(1.7*s).moveTo(48*s, 258*s).lineTo(270*s, 258*s).stroke();
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(12*s).text("REAL ESTATE ADVISORY", 0, 278*s, { width: 318*s, align: "center", characterSpacing: 3*s });
      doc.restore();
    }

    function drawLogoHorizontal(x, y, scale = 1) {
      doc.save();
      doc.translate(x, y);
      const s = scale;
      doc.fillColor(GREEN2).rect(0, 48*s, 18*s, 60*s).fill();
      doc.fillColor("#809597").rect(28*s, 28*s, 20*s, 80*s).fill();
      doc.fillColor("#A5B2B4").rect(60*s, 8*s, 23*s, 100*s).fill();
      doc.fillColor(GOLD).rect(96*s, 0, 25*s, 108*s).fill();
      doc.fillColor(GOLD).rect(132*s, 0, 25*s, 108*s).fill();
      doc.fillColor(GREEN).rect(96*s, 52*s, 61*s, 18*s).fill();
      doc.fillColor("#A5B2B4").rect(170*s, 8*s, 23*s, 100*s).fill();
      doc.fillColor("#809597").rect(205*s, 28*s, 20*s, 80*s).fill();
      doc.fillColor(GREEN2).rect(237*s, 48*s, 18*s, 60*s).fill();
      doc.strokeColor(GOLD).lineWidth(2*s).moveTo(0, 108*s).lineTo(255*s, 108*s).stroke();
      doc.strokeColor(GOLD).lineWidth(1.4*s).moveTo(288*s, -6*s).lineTo(288*s, 124*s).stroke();
      doc.fillColor(WHITE).font("Times-Bold").fontSize(52*s).text("HOCH", 322*s, 28*s, { characterSpacing: 4*s });
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(11*s).text("REAL ESTATE ADVISORY", 324*s, 84*s, { characterSpacing: 2.5*s });
      doc.restore();
    }

    function coverPage() {
      doc.rect(0, 0, W, H).fill(GREEN);
      architecturePattern(0.12);
      doc.save();
      doc.opacity(0.28);
      doc.rect(0, 0, W, H).fill(GREEN);
      doc.restore();

      drawLogoVertical(W / 2, 170, 0.82);

      doc.fillColor(WHITE).font("Times-Bold").fontSize(58).text("EXPOSÉ", 0, 520, { width: W, align: "center", characterSpacing: 1.5 });

      doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(17).text((obj.titel || "").toUpperCase(), 90, 635, {
        width: W - 180,
        align: "center",
        lineGap: 6
      });

      if (obj.ort) {
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(13).text(obj.ort.toUpperCase(), 90, doc.y + 8, {
          width: W - 180,
          align: "center"
        });
      }
    }

    function titleHeader(title, subtitle = "") {
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(9).text("EXPOSÉ", 45, 34, { characterSpacing: 2 });
      doc.fillColor(GREEN).font("Times-Bold").fontSize(25).text(title, 45, 68, { width: W - 90, lineGap: 2 });
      if (subtitle) doc.fillColor(GRAY).font("Helvetica").fontSize(10).text(subtitle, 45, doc.y + 5, { width: W - 90 });
    }

    function highlightList(raw, x, y, w) {
      const items = text(raw)
        .split(/\n|•/)
        .map(v => v.replace(/^-/, "").trim())
        .filter(Boolean)
        .slice(0, 8);
      if (!items.length) return y;
      doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(11).text("Highlights auf einen Blick", x, y, { width: w });
      y += 22;
      items.forEach(item => {
        doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(10).text("•", x, y, { continued: true });
        doc.fillColor(DARK).font("Helvetica").fontSize(9.2).text(" " + item, { width: w - 12, lineGap: 3 });
        y = doc.y + 5;
      });
      return y;
    }

    function galleryLayout(n, x, y, w, h, gap = 8) {
      const slots = [];
      if (n <= 0) return slots;
      if (n === 1) return [[x, y, w, h]];
      if (n === 2) return [[x, y, w, (h-gap)/2], [x, y+(h+gap)/2, w, (h-gap)/2]];
      if (n === 3) return [[x, y, w, h*0.55], [x, y+h*0.55+gap, (w-gap)/2, h*0.45-gap], [x+(w+gap)/2, y+h*0.55+gap, (w-gap)/2, h*0.45-gap]];
      if (n === 4) {
        const cw=(w-gap)/2, ch=(h-gap)/2;
        return [[x,y,cw,ch],[x+cw+gap,y,cw,ch],[x,y+ch+gap,cw,ch],[x+cw+gap,y+ch+gap,cw,ch]];
      }
      if (n === 5) {
        const bigW = w*0.58, smallW = w-bigW-gap, smallH = (h-3*gap)/4;
        slots.push([x,y,bigW,h]);
        for(let i=0;i<4;i++) slots.push([x+bigW+gap, y+i*(smallH+gap), smallW, smallH]);
        return slots;
      }
      // 6+ -> 2 columns x 3 rows
      const cw=(w-gap)/2, ch=(h-2*gap)/3;
      for(let row=0; row<3; row++) {
        for(let col=0; col<2; col++) slots.push([x+col*(cw+gap), y+row*(ch+gap), cw, ch]);
      }
      return slots;
    }

    async function descriptionGalleryPage(buffers) {
      doc.addPage();
      doc.rect(0, 0, W, H).fill(CREAM);
      architecturePattern(0.055);

      titleHeader(obj.titel || "Objekt", obj.ort || "");

      const leftX = 45, rightX = 365;
      const leftW = 285, rightW = 185;

      doc.fillColor(DARK).font("Helvetica").fontSize(9.4).text(truncate(obj.beschreibung, 1500), leftX, 150, {
        width: leftW,
        lineGap: 4,
        height: 350
      });

      let y = highlightList(obj.highlights, leftX, 525, leftW);

      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(10).text(obj.preisText || "auf Anfrage", leftX, 735, { width: 130 });
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(8).text(obj.preisart || obj.vermarktungsart || "", leftX + 135, 737, { width: 160 });

      const imgs = buffers.slice(0, 6);
      const slots = galleryLayout(imgs.length, rightX, 150, rightW, 535, 7);
      slots.forEach((slot, i) => imageCover(imgs[i], ...slot));

      doc.fillColor(GRAY).font("Helvetica").fontSize(7).text("HOCH Real Estate Advisory", rightX, 720, { width: rightW, align: "right" });
    }

    function collectFacts() {
      const facts = [
        ["Titel", obj.titel],
        ["Ort", obj.ort],
        ["Typ", obj.typ],
        ["Objektart", obj.objektart],
        ["Nutzung", obj.nutzung],
        ["Vermarktung", obj.vermarktungsart],
        ["Status", obj.status],
        ["Preis", obj.preisText],
        ["Preisart", obj.preisart],
        ["Fläche", obj.flaeche ? `${formatNumber(obj.flaeche)} m²` : ""],
        ["Zimmer", obj.zimmer],
        ["Etage", obj.etage],
        ["Lagerfläche", obj.lagerflaeche ? `${formatNumber(obj.lagerflaeche)} m²` : ""],
        ["Teilbar ab", obj.teilbarAb ? `${formatNumber(obj.teilbarAb)} m²` : ""],
        ["Verfügbarkeit", obj.verfuegbarkeit],
        ["Baujahr", obj.baujahr],
        ["Energie", obj.energie]
      ];
      return facts.filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
    }

    async function factsPage(buffers) {
      doc.addPage();
      doc.rect(0, 0, W, H).fill(WHITE);
      architecturePattern(0.035);

      doc.fillColor(GREEN).font("Times-Bold").fontSize(33).text("OBJEKTDATEN", 45, 55);
      doc.strokeColor(GOLD).lineWidth(1.2).moveTo(45, 103).lineTo(550, 103).stroke();

      const facts = collectFacts().slice(0, 12);
      const gap = 8;
      const cols = 3;
      const cardW = (W - 90 - gap * (cols - 1)) / cols;
      const cardH = 58;
      let x = 45, y = 130;

      facts.forEach((f, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        x = 45 + col * (cardW + gap);
        y = 130 + row * (cardH + gap);
        doc.roundedRect(x, y, cardW, cardH, 4).fillAndStroke(CREAM, LIGHT_LINE);
        doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(7).text(f[0].toUpperCase(), x + 11, y + 11, { width: cardW - 22, characterSpacing: 0.8 });
        doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(11).text(String(f[1]), x + 11, y + 29, { width: cardW - 22, height: 22 });
      });

      const startImagesY = 425;
      const imgs = buffers.slice(6, 12);
      const used = imgs.length ? imgs : buffers.slice(0, 6);
      const slots = galleryLayout(Math.min(used.length, 6), 45, startImagesY, W - 90, 330, 8);
      slots.forEach((slot, i) => imageCover(used[i], ...slot));
    }

    function contactPage() {
      doc.addPage();
      doc.rect(0, 0, W, H).fill(CREAM);
      architecturePattern(0.05);

      doc.fillColor(GREEN).font("Times-Bold").fontSize(42).text("SIE HABEN\nINTERESSE\nAN DIESEM\nOBJEKT?", 60, 95, {
        width: W - 120,
        align: "center",
        lineGap: 10
      });

      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(19).text("WIR BERATEN SIE GERNE!", 0, 430, { width: W, align: "center" });

      doc.rect(0, 565, W, H - 565).fill(GREEN);
      doc.strokeColor(GOLD).lineWidth(2).moveTo(W / 2, 565).lineTo(W / 2, H).stroke();

      drawLogoVertical(W / 4, 638, 0.44);

      doc.fillColor(GOLD).font("Times-Bold").fontSize(19).text("Christian Hoch", 355, 640);
      doc.fillColor(WHITE).font("Times-Roman").fontSize(10).text("Geschäftsführer", 355, 662);

      const contact = [
        ["☎", "+49 (0) 171 5744 947"],
        ["✉", "c.hoch@friends-of-work.de"],
        ["⌾", "www.hoch-real-estate.de"],
        ["●", "Emsstraße 18, 26135 Oldenburg"]
      ];

      let cy = 700;
      contact.forEach(([icon, value]) => {
        doc.circle(365, cy + 5, 10).strokeColor(GOLD).lineWidth(1).stroke();
        doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(8).text(icon, 360, cy, { width: 12, align: "center" });
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9.2).text(value, 392, cy, { width: 165 });
        cy += 28;
      });
    }

    const imageBuffers = [];
    for (const url of (obj.bilder || []).slice(0, 12)) {
      const b = await imageBuffer(url);
      if (b) imageBuffers.push(b);
    }

    coverPage();
    await descriptionGalleryPage(imageBuffers);
    await factsPage(imageBuffers);
    contactPage();

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      if (i > 0) {
        doc.fillColor(GRAY).font("Helvetica").fontSize(7).text(`${i + 1}/${range.count}`, W - 64, H - 28);
      }
    }

    doc.end();
  } catch (error) {
    return res.status(500).json({ error: "Serverfehler", details: error.message });
  }
}
