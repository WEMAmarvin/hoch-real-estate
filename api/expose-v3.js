import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      const details = await notionRes.text();
      return res.status(notionRes.status).json({ error: "Notion API Fehler", details });
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
      if (art.includes("m²") || art.includes("m2") || art.includes("qm") || art.includes("pro")) return `${formatNumber(preis)} €/m²${mietSuffix}`;
      return `${formatNumber(preis)} €${mietSuffix}`;
    }

    function mapPage(page, index) {
      const p = page.properties || {};
      const titel = plain(findProp(p, ["Titel", "Name"]));
      const ort = plain(findProp(p, ["Ort", "Adresse", "Standort"]));
      const typ = select(findProp(p, ["Typ", "Kategorie"]));
      const objektart = select(findProp(p, ["Objektart"]));
      const nutzung = select(findProp(p, ["Nutzung"]));
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
      const verfuegbarkeit = plain(findProp(p, ["Verfügbarkeit", "Verfuegbarkeit", "Bezugsfrei"]));
      const baujahr = plain(findProp(p, ["Baujahr"]));
      const energie = plain(findProp(p, ["Energie", "Energieausweis"]));
      const beschreibung = plain(findProp(p, ["Beschreibung", "Kurzbeschreibung"]));
      const lage = plain(findProp(p, ["Lage", "Lagebeschreibung"]));
      const ausstattung = plain(findProp(p, ["Ausstattung"]));
      const highlights = plain(findProp(p, ["Highlights", "Highlights auf einen Blick"]));
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

    const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true, bufferPages: true });
    doc.pipe(res);

    const W = doc.page.width;
    const H = doc.page.height;
    const GREEN = "#00424a";
    const GREEN2 = "#13686F";
    const GOLD = "#C8A46B";
    const CREAM = "#F7F4EF";
    const GRAY = "#6b7280";
    const DARK = "#2B2B2B";
    const WHITE = "#ffffff";
    const LINE = "#ded7cc";

    function localAsset(...parts) {
      const candidates = [
        path.join(__dirname, "..", ...parts),
        path.join(process.cwd(), ...parts),
        path.join(process.cwd(), "public", ...parts)
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
      return null;
    }

    const logoVertical = localAsset("assets", "hoch-logo-vertical.png");
    const logoHorizontal = localAsset("assets", "hoch-logo-horizontal.png");

    async function imageBuffer(url) {
      if (!url) return null;
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const type = r.headers.get("content-type") || "";
        if (!type.includes("image") && !url.match(/\.(png|jpe?g)(\?|$)/i)) return null;
        return Buffer.from(await r.arrayBuffer());
      } catch {
        return null;
      }
    }

    function clean(v) {
      return String(v || "").replace(/\r/g, "").trim();
    }

    function drawSubtleArchitecture(opacity = 0.06, color = GRAY) {
      doc.save();
      doc.opacity(opacity);
      doc.strokeColor(color).lineWidth(0.6);
      for (let x = -160; x < W + 180; x += 46) {
        doc.moveTo(x, 0).lineTo(x + 230, H).stroke();
      }
      for (let y = 52; y < H; y += 92) {
        doc.roundedRect(W - 210, y, 135, 18, 9).stroke();
        doc.roundedRect(W - 70, y + 18, 95, 14, 7).stroke();
      }
      doc.restore();
    }

    function drawVerticalLogo(x, y, w) {
      if (logoVertical) {
        doc.image(logoVertical, x, y, { width: w });
        return;
      }
      doc.fillColor(WHITE).font("Times-Bold").fontSize(42).text("HOCH", x, y, { width: w, align: "center" });
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(9).text("REAL ESTATE ADVISORY", x, y + 48, { width: w, align: "center" });
    }

    function drawHorizontalLogo(x, y, w) {
      if (logoHorizontal) {
        doc.image(logoHorizontal, x, y, { width: w });
        return;
      }
      doc.fillColor(WHITE).font("Times-Bold").fontSize(28).text("HOCH", x, y);
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(7).text("REAL ESTATE ADVISORY", x, y + 30);
    }

    function fitImage(buffer, x, y, w, h) {
      if (!buffer) {
        doc.rect(x, y, w, h).fill("#e6e0d7");
        return;
      }
      try {
        doc.image(buffer, x, y, { fit: [w, h], width: w, height: h, align: "center", valign: "center" });
      } catch {
        doc.rect(x, y, w, h).fill("#e6e0d7");
      }
    }

    function trimText(value, maxChars) {
      const v = clean(value);
      if (v.length <= maxChars) return v;
      return v.slice(0, maxChars - 1).trim() + "…";
    }

    function gallerySlots(count, x, y, w, h, gap = 8) {
      const n = Math.min(count, 6);
      if (n <= 0) return [];
      if (n === 1) return [[x, y, w, h]];
      if (n === 2) {
        const ch = (h - gap) / 2;
        return [[x, y, w, ch], [x, y + ch + gap, w, ch]];
      }
      if (n === 3) {
        const top = h * 0.52;
        const bottom = h - top - gap;
        return [[x, y, w, top], [x, y + top + gap, (w - gap) / 2, bottom], [x + (w + gap) / 2, y + top + gap, (w - gap) / 2, bottom]];
      }
      if (n === 4) {
        const cw = (w - gap) / 2, ch = (h - gap) / 2;
        return [[x, y, cw, ch], [x + cw + gap, y, cw, ch], [x, y + ch + gap, cw, ch], [x + cw + gap, y + ch + gap, cw, ch]];
      }
      if (n === 5) {
        const bigW = w * 0.58, smallW = w - bigW - gap, smallH = (h - 3 * gap) / 4;
        return [[x, y, bigW, h], [x + bigW + gap, y, smallW, smallH], [x + bigW + gap, y + smallH + gap, smallW, smallH], [x + bigW + gap, y + 2 * (smallH + gap), smallW, smallH], [x + bigW + gap, y + 3 * (smallH + gap), smallW, smallH]];
      }
      const cw = (w - gap) / 2, ch = (h - 2 * gap) / 3;
      return [[x, y, cw, ch], [x + cw + gap, y, cw, ch], [x, y + ch + gap, cw, ch], [x + cw + gap, y + ch + gap, cw, ch], [x, y + 2 * (ch + gap), cw, ch], [x + cw + gap, y + 2 * (ch + gap), cw, ch]];
    }

    function highlights(raw, x, y, w) {
      const items = clean(raw).split(/\n|•/).map(s => s.replace(/^-/, "").trim()).filter(Boolean).slice(0, 8);
      if (!items.length) return y;
      doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(12).text("Highlights auf einen Blick", x, y, { width: w });
      y += 25;
      for (const item of items) {
        doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(9).text("•", x, y, { continued: true });
        doc.fillColor(DARK).font("Helvetica").fontSize(9.2).text(" " + item, { width: w - 12, lineGap: 2 });
        y = doc.y + 5;
      }
      return y;
    }

    function facts() {
      return [
        ["TITEL", obj.titel],
        ["ORT", obj.ort],
        ["TYP", obj.typ],
        ["OBJEKTART", obj.objektart],
        ["NUTZUNG", obj.nutzung],
        ["VERMARKTUNG", obj.vermarktungsart],
        ["STATUS", obj.status],
        ["PREIS", obj.preisText],
        ["PREISART", obj.preisart],
        ["FLÄCHE", obj.flaeche ? `${formatNumber(obj.flaeche)} m²` : ""],
        ["ZIMMER", obj.zimmer],
        ["ETAGE", obj.etage],
        ["LAGERFLÄCHE", obj.lagerflaeche ? `${formatNumber(obj.lagerflaeche)} m²` : ""],
        ["TEILBAR AB", obj.teilbarAb ? `${formatNumber(obj.teilbarAb)} m²` : ""],
        ["VERFÜGBARKEIT", obj.verfuegbarkeit],
        ["BAUJAHR", obj.baujahr],
        ["ENERGIE", obj.energie]
      ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");
    }

    // PAGE 1: Canva-like cover
    function pageCover() {
      doc.rect(0, 0, W, H).fill(GREEN);
      drawSubtleArchitecture(0.12, WHITE);
      doc.save();
      doc.opacity(0.25);
      doc.rect(0, 0, W, H).fill("#002c32");
      doc.restore();

      drawVerticalLogo((W - 285) / 2, 205, 285);

      doc.fillColor(WHITE).font("Times-Bold").fontSize(60).text("EXPOSÉ", 0, 535, { width: W, align: "center", characterSpacing: 1 });
      doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(18).text(clean(obj.titel).toUpperCase(), 95, 635, { width: W - 190, align: "center", lineGap: 5 });
      if (obj.ort) {
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(13).text(clean(obj.ort).toUpperCase(), 95, doc.y + 10, { width: W - 190, align: "center" });
      }
    }

    // PAGE 2: title, description, highlights, price, adaptive gallery
    function pageDescriptionGallery(imageBuffers) {
      doc.addPage();
      doc.rect(0, 0, W, H).fill(CREAM);
      drawSubtleArchitecture(0.055, GRAY);

      const leftX = 44, top = 48, textW = 305;
      const rightX = 382, rightW = 168;

      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(8).text("EXPOSÉ", leftX, top, { characterSpacing: 1.6 });
      doc.fillColor(GREEN).font("Times-Bold").fontSize(29).text(clean(obj.titel).toUpperCase(), leftX, top + 32, { width: textW, lineGap: 1 });
      if (obj.ort) doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9.5).text(clean(obj.ort), leftX, doc.y + 2, { width: textW });

      doc.fillColor(DARK).font("Helvetica").fontSize(9.2).text(trimText(obj.beschreibung, 1650), leftX, 178, { width: textW, lineGap: 3.6, height: 315 });

      highlights(obj.highlights, leftX, 520, textW);

      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(15).text(obj.preisText || "auf Anfrage", leftX, 760, { width: 190 });
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text(obj.preisart || obj.vermarktungsart || "", leftX + 205, 765, { width: 125 });

      const imgs = imageBuffers.slice(0, 6);
      const slots = gallerySlots(imgs.length, rightX, 92, rightW, 635, 8);
      slots.forEach((slot, i) => fitImage(imgs[i], ...slot));
      doc.fillColor(GRAY).font("Helvetica").fontSize(7).text("HOCH Real Estate Advisory", rightX, 755, { width: rightW, align: "right" });
    }

    // PAGE 3: facts grid and images
    function pageFactsImages(imageBuffers) {
      doc.addPage();
      doc.rect(0, 0, W, H).fill(WHITE);
      drawSubtleArchitecture(0.035, GRAY);

      doc.fillColor(GREEN).font("Times-Bold").fontSize(36).text("OBJEKTDATEN", 44, 55);
      doc.strokeColor(GOLD).lineWidth(1.2).moveTo(44, 110).lineTo(W - 44, 110).stroke();

      const list = facts().slice(0, 12);
      const cols = 3, gap = 9, cardW = (W - 88 - gap * 2) / 3, cardH = 58;
      list.forEach(([label, value], i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = 44 + col * (cardW + gap);
        const y = 140 + row * (cardH + gap);
        doc.roundedRect(x, y, cardW, cardH, 4).fillAndStroke(CREAM, LINE);
        doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(7).text(label, x + 10, y + 10, { width: cardW - 20, characterSpacing: 0.9 });
        doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(10.5).text(String(value), x + 10, y + 28, { width: cardW - 20, height: 24 });
      });

      const imgs = imageBuffers.slice(6, 12).length ? imageBuffers.slice(6, 12) : imageBuffers.slice(0, 6);
      const slots = gallerySlots(Math.min(imgs.length, 6), 44, 440, W - 88, 300, 9);
      slots.forEach((slot, i) => fitImage(imgs[i], ...slot));
    }

    // PAGE 4: Canva-like contact page
    function pageContact() {
      doc.addPage();
      doc.rect(0, 0, W, H).fill(CREAM);
      drawSubtleArchitecture(0.055, GRAY);

      doc.fillColor(GREEN).font("Times-Bold").fontSize(42).text("SIE HABEN\nINTERESSE\nAN DIESEM\nOBJEKT?", 70, 105, { width: W - 140, align: "center", lineGap: 12 });
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(20).text("WIR BERATEN SIE GERNE!", 0, 430, { width: W, align: "center" });

      doc.rect(0, 565, W, H - 565).fill(GREEN);
      doc.strokeColor(GOLD).lineWidth(2).moveTo(W / 2, 565).lineTo(W / 2, H).stroke();

      drawVerticalLogo(76, 636, 205);

      doc.fillColor(GOLD).font("Times-Bold").fontSize(20).text("Christian Hoch", 350, 648);
      doc.fillColor(WHITE).font("Times-Roman").fontSize(10).text("Geschäftsführer", 350, 672);

      const contact = [
        "+49 (0) 171 5744 947",
        "c.hoch@friends-of-work.de",
        "www.hoch-real-estate.de",
        "Emsstraße 18, 26135 Oldenburg"
      ];
      let y = 710;
      contact.forEach((value) => {
        doc.circle(360, y + 4, 9).strokeColor(GOLD).lineWidth(1).stroke();
        doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(7).text("•", 357, y - 1);
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9.2).text(value, 386, y, { width: 170 });
        y += 26;
      });
    }

    const imageBuffers = [];
    for (const url of (obj.bilder || []).slice(0, 12)) {
      const b = await imageBuffer(url);
      if (b) imageBuffers.push(b);
    }

    pageCover();
    pageDescriptionGallery(imageBuffers);
    pageFactsImages(imageBuffers);
    pageContact();

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
