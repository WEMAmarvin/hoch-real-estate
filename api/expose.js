import PDFDocument from "pdfkit";

export default async function handler(req, res) {
  try {
    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID || "34fa4c6888f080c8b2f0f54e1dd714a5";
    const requestedId = String(req.query.id || "").trim();

    if (!notionToken) {
      return res.status(500).json({ error: "NOTION_TOKEN fehlt in den Environment Variables." });
    }

    if (!requestedId) {
      return res.status(400).json({ error: "Immobilien-ID fehlt." });
    }

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sorts: [{ timestamp: "created_time", direction: "descending" }]
      })
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
        beschreibung,
        lage,
        ausstattung,
        highlights,
        bilder
      };
    }

    const items = (data.results || []).map(mapPage).filter(item => item.titel);
    const obj = items.find(item => String(item.notionId) === requestedId || String(item.id) === requestedId);

    if (!obj) {
      return res.status(404).json({ error: "Immobilie nicht gefunden." });
    }

    const safeName = (obj.titel || "Expose").replace(/[^a-z0-9äöüß\- ]/gi, "").replace(/\s+/g, "-").slice(0, 80);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-Expose.pdf"`);

    const doc = new PDFDocument({ size: "A4", margin: 44, bufferPages: true });
    doc.pipe(res);

    const GREEN = "#00424a";
    const GOLD = "#C8A46B";
    const CREAM = "#F7F4EF";
    const GRAY = "#6b7280";
    const DARK = "#2B2B2B";
    const WHITE = "#ffffff";

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 44;

    async function imageBuffer(url) {
      if (!url) return null;
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch {
        return null;
      }
    }

    function cleanText(value) {
      return String(value || "").replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").trim();
    }

    function ensureSpace(height) {
      if (doc.y + height > pageH - 58) {
        doc.addPage();
        drawPageHeader(false);
      }
    }

    function drawPageHeader(withHero = false) {
      if (!withHero) {
        doc.rect(0, 0, pageW, 28).fill(GREEN);
        doc.fillColor(GOLD).font("Helvetica").fontSize(7).text("HOCH REAL ESTATE ADVISORY", margin, 10, {
          characterSpacing: 1.4
        });
      }
    }

    function drawLogo(x, y, scale = 1) {
      const sx = scale;
      doc.save();
      doc.translate(x, y);
      doc.fillColor("rgba(255,255,255,0.2)").rect(0*sx, 22*sx, 6*sx, 18*sx).fill();
      doc.fillColor("rgba(255,255,255,0.4)").rect(9*sx, 14*sx, 6*sx, 26*sx).fill();
      doc.fillColor("rgba(255,255,255,0.6)").rect(18*sx, 5*sx, 8*sx, 35*sx).fill();
      doc.fillColor(GOLD).rect(29*sx, 0, 11*sx, 40*sx).fill();
      doc.fillColor(GOLD).rect(43*sx, 0, 11*sx, 40*sx).fill();
      doc.fillColor(GREEN).rect(29*sx, 16*sx, 25*sx, 6*sx).fill();
      doc.fillColor("rgba(255,255,255,0.6)").rect(57*sx, 5*sx, 8*sx, 35*sx).fill();
      doc.fillColor("rgba(255,255,255,0.4)").rect(68*sx, 14*sx, 6*sx, 26*sx).fill();
      doc.fillColor("rgba(255,255,255,0.2)").rect(77*sx, 22*sx, 6*sx, 18*sx).fill();
      doc.strokeColor(GOLD).lineWidth(1*sx).moveTo(0, 40*sx).lineTo(83*sx, 40*sx).stroke();
      doc.strokeColor(GOLD).lineWidth(0.7*sx).moveTo(97*sx, -4*sx).lineTo(97*sx, 46*sx).stroke();
      doc.fillColor(WHITE).font("Times-Bold").fontSize(22*sx).text("HOCH", 110*sx, 11*sx, { characterSpacing: 3*sx, lineBreak: false });
      doc.fillColor(GOLD).font("Helvetica").fontSize(6.5*sx).text("REAL ESTATE ADVISORY", 111*sx, 34*sx, { characterSpacing: 1.6*sx, lineBreak: false });
      doc.restore();
    }

    function fact(label, value) {
      if (value === null || value === undefined || value === "") return null;
      return { label, value: String(value) };
    }

    function sectionTitle(title) {
      ensureSpace(54);
      doc.moveDown(0.8);
      doc.fillColor(GOLD).font("Helvetica").fontSize(8).text(title.toUpperCase(), margin, doc.y, { characterSpacing: 1.6 });
      doc.moveDown(0.25);
      doc.strokeColor(GOLD).lineWidth(0.7).moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).stroke();
      doc.moveDown(0.8);
    }

    function paragraph(text) {
      const value = cleanText(text);
      if (!value) return;
      ensureSpace(90);
      doc.fillColor(DARK).font("Helvetica").fontSize(10.5).text(value, margin, doc.y, {
        width: pageW - margin * 2,
        lineGap: 4
      });
    }

    function drawFactsGrid(facts) {
      const valid = facts.filter(Boolean);
      if (!valid.length) return;

      ensureSpace(120);
      const colW = (pageW - margin * 2) / 3;
      const rowH = 55;
      const startY = doc.y;

      valid.forEach((item, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const x = margin + col * colW;
        const y = startY + row * rowH;

        doc.rect(x, y, colW, rowH).strokeColor("#d8d2c7").lineWidth(0.5).stroke();
        doc.fillColor(GRAY).font("Helvetica").fontSize(7.5).text(item.label.toUpperCase(), x + 12, y + 12, { width: colW - 24, characterSpacing: 0.7 });
        doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(12).text(item.value, x + 12, y + 30, { width: colW - 24 });
      });

      doc.y = startY + Math.ceil(valid.length / 3) * rowH + 18;
    }

    // Cover
    doc.rect(0, 0, pageW, pageH).fill(CREAM);
    doc.rect(0, 0, pageW, 170).fill(GREEN);
    drawLogo(margin, 54, 1.2);

    doc.fillColor(GOLD).font("Helvetica").fontSize(9).text("EXPOSÉ", margin, 205, { characterSpacing: 2.5 });
    doc.fillColor(GREEN).font("Times-Roman").fontSize(34).text(obj.titel || "Immobilie", margin, 230, {
      width: pageW - margin * 2,
      lineGap: 2
    });

    if (obj.ort) {
      doc.fillColor(GRAY).font("Helvetica").fontSize(12).text(obj.ort, margin, doc.y + 10);
    }

    const mainImage = await imageBuffer(obj.bilder?.[0]);
    if (mainImage) {
      try {
        doc.image(mainImage, margin, 360, { width: pageW - margin * 2, height: 260, fit: [pageW - margin * 2, 260], align: "center", valign: "center" });
      } catch {}
    } else {
      doc.rect(margin, 360, pageW - margin * 2, 260).fill("#e8e3d9");
      doc.fillColor(GRAY).font("Helvetica").fontSize(12).text("Bild wird geladen / nicht verfügbar", margin, 480, { width: pageW - margin * 2, align: "center" });
    }

    doc.fillColor(GRAY).font("Helvetica").fontSize(8).text("HOCH Real Estate Advisory · Gewerbeimmobilien. Beratung & Vermittlung.", margin, pageH - 62, {
      width: pageW - margin * 2,
      align: "center"
    });

    // Details
    doc.addPage();
    doc.rect(0, 0, pageW, pageH).fill(WHITE);
    drawPageHeader(false);
    doc.y = 64;

    sectionTitle("Objektdaten");
    drawFactsGrid([
      fact("Typ", obj.typ),
      fact("Vermarktung", obj.vermarktungsart),
      fact("Status", obj.status),
      fact("Preis", obj.preisText),
      fact("Fläche", obj.flaeche ? `${formatNumber(obj.flaeche)} m²` : ""),
      fact("Zimmer", obj.zimmer),
      fact("Etage", obj.etage),
      fact("Lagerfläche", obj.lagerflaeche ? `${formatNumber(obj.lagerflaeche)} m²` : ""),
      fact("Teilbar ab", obj.teilbarAb ? `${formatNumber(obj.teilbarAb)} m²` : "")
    ]);

    if (obj.beschreibung) {
      sectionTitle("Beschreibung");
      paragraph(obj.beschreibung);
    }

    if (obj.highlights) {
      sectionTitle("Highlights auf einen Blick");
      const list = cleanText(obj.highlights).split(/\n|•|-/).map(v => v.trim()).filter(Boolean);
      list.forEach(item => {
        ensureSpace(24);
        doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(10).text("•", margin, doc.y, { continued: true });
        doc.fillColor(DARK).font("Helvetica").fontSize(10.5).text(`  ${item}`, { width: pageW - margin * 2 - 12, lineGap: 4 });
      });
    }

    if (obj.lage) {
      sectionTitle("Lage");
      paragraph(obj.lage);
    }

    if (obj.ausstattung) {
      sectionTitle("Ausstattung");
      paragraph(obj.ausstattung);
    }

    // Image gallery page
    const moreImages = (obj.bilder || []).slice(1, 5);
    if (moreImages.length) {
      doc.addPage();
      doc.rect(0, 0, pageW, pageH).fill(CREAM);
      drawPageHeader(false);
      doc.y = 64;
      sectionTitle("Bilder");

      const slots = [
        [margin, 105, (pageW - margin * 2 - 14) / 2, 210],
        [margin + (pageW - margin * 2 + 14) / 2, 105, (pageW - margin * 2 - 14) / 2, 210],
        [margin, 335, (pageW - margin * 2 - 14) / 2, 210],
        [margin + (pageW - margin * 2 + 14) / 2, 335, (pageW - margin * 2 - 14) / 2, 210]
      ];

      for (let i = 0; i < moreImages.length; i++) {
        const img = await imageBuffer(moreImages[i]);
        if (!img) continue;
        const [x, y, w, h] = slots[i];
        try {
          doc.image(img, x, y, { width: w, height: h, fit: [w, h], align: "center", valign: "center" });
        } catch {}
      }
    }

    // Contact page
    doc.addPage();
    doc.rect(0, 0, pageW, pageH).fill(GREEN);
    drawLogo(margin, 90, 1.3);
    doc.fillColor(WHITE).font("Times-Roman").fontSize(30).text("Interesse an diesem Objekt?", margin, 260, { width: pageW - margin * 2 });
    doc.fillColor("rgba(255,255,255,0.75)").font("Helvetica").fontSize(11).text("Wir begleiten Sie diskret, strukturiert und mit fundierter Marktkenntnis.", margin, 310, {
      width: pageW - margin * 2,
      lineGap: 4
    });

    doc.fillColor(GOLD).font("Helvetica").fontSize(9).text("KONTAKT", margin, 410, { characterSpacing: 2 });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(13).text("Christian Hoch", margin, 440);
    doc.fillColor("rgba(255,255,255,0.75)").font("Helvetica").fontSize(10.5)
      .text("c.hoch@friends-of-work.de", margin, 466)
      .text("+49 (0) 171 5744 947", margin, 486)
      .text("Emsstraße 18 · 26135 Oldenburg", margin, 506);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      if (i > 0 && i < range.count - 1) {
        doc.fillColor(GRAY).font("Helvetica").fontSize(7).text(`${i + 1}/${range.count}`, pageW - margin - 30, pageH - 35);
      }
    }

    doc.end();
  } catch (error) {
    return res.status(500).json({ error: "Serverfehler", details: error.message });
  }
}
