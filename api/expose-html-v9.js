export default async function handler(req, res) {
  try {
    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID || "34fa4c6888f080c8b2f0f54e1dd714a5";
    const requestedId = String(req.query.id || "").trim();

    if (!notionToken) return res.status(500).send("NOTION_TOKEN fehlt.");
    if (!requestedId) return res.status(400).send("Immobilien-ID fehlt.");

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sorts: [{ timestamp: "created_time", direction: "descending" }] })
    });

    if (!notionRes.ok) return res.status(notionRes.status).send(await notionRes.text());
    const data = await notionRes.json();

    const esc = v => String(v ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));

    const nl2br = v => esc(v).replace(/\n/g, "<br>");

    function findProp(props, names) {
      for (const n of names) if (Object.prototype.hasOwnProperty.call(props, n)) return props[n];
      const lower = Object.fromEntries(Object.keys(props || {}).map(k => [k.toLowerCase(), k]));
      for (const n of names) {
        const key = lower[String(n).toLowerCase()];
        if (key) return props[key];
      }
    }

    function plain(prop) {
      if (!prop) return "";
      if (prop.type === "title") return (prop.title || []).map(t => t.plain_text || "").join("").trim();
      if (prop.type === "rich_text") return (prop.rich_text || []).map(t => t.plain_text || "").join("").trim();
      if (prop.type === "select") return prop.select?.name || "";
      if (prop.type === "multi_select") return (prop.multi_select || []).map(s => s.name).join(", ");
      if (prop.type === "number") return prop.number ?? "";
      if (prop.type === "date") return [prop.date?.start, prop.date?.end].filter(Boolean).join(" – ");
      if (prop.type === "url") return prop.url || "";
      if (prop.type === "email") return prop.email || "";
      if (prop.type === "phone_number") return prop.phone_number || "";
      if (prop.type === "checkbox") return prop.checkbox ? "Ja" : "";
      if (prop.type === "formula") {
        const f = prop.formula;
        if (!f) return "";
        if (f.type === "string") return f.string || "";
        if (f.type === "number") return f.number ?? "";
        if (f.type === "boolean") return f.boolean ? "Ja" : "";
        if (f.type === "date") return f.date?.start || "";
      }
      return "";
    }

    function number(prop) {
      if (!prop) return null;
      if (prop.type === "number") return typeof prop.number === "number" ? prop.number : null;
      const n = Number(String(plain(prop)).replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    }

    function select(prop) {
      if (!prop) return "";
      return prop.type === "select" ? (prop.select?.name || "") : plain(prop);
    }

    function splitUrls(value) {
      return String(value || "").split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
    }

    function files(prop) {
      if (!prop) return [];
      if (prop.type === "files") {
        return (prop.files || []).map(f => f.type === "file" ? f.file?.url : f.external?.url).filter(Boolean);
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

    function formatNumber(v) {
      if (v === null || v === undefined || v === "") return "";
      return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(v);
    }

    function formatCurrency(value) {
      if (value === null || value === undefined || value === "") return "";
      return `${formatNumber(value)} €`;
    }

    function formatArea(value) {
      if (value === null || value === undefined || value === "") return "";
      return `${formatNumber(value)} m²`;
    }

    function priceText(preis, preisart, vermarktungsart) {
      const art = String(preisart || "").toLowerCase();
      const verm = String(vermarktungsart || "").toLowerCase();
      const miet = verm.includes("miete") && !art.includes("miete") ? " Miete" : "";
      if (art.includes("anfrage") || preis === null || preis === undefined || preis === "") return "auf Anfrage";
      if (art.includes("m²") || art.includes("m2") || art.includes("qm") || art.includes("pro")) return `${formatNumber(preis)} €/m²${miet}`;
      return `${formatNumber(preis)} €${miet}`;
    }

    function mapPage(page, index) {
      const p = page.properties || {};
      const titel = plain(findProp(p, ["Titel", "Name"]));
      const ort = plain(findProp(p, ["Ort", "Adresse", "Standort"]));
      const vermarktungsart = select(findProp(p, ["Vermarktungsart", "Vermarktung"]));
      const preis = number(findProp(p, ["Preis", "Kaufpreis", "Mietpreis"]));
      const preisart = select(findProp(p, ["Preisart", "Preistyp", "Preis Typ"]));
      const etageRaw = plain(findProp(p, ["Etage(n)", "Etagen", "Etage"]));
      const bilder = [...new Set([
        ...files(findProp(p, ["Bild", "Bilder", "Foto", "Fotos", "Galerie", "Exposé Bilder"])),
        cover(page)
      ].filter(Boolean))];

      return {
        id: index + 1,
        notionId: page.id,
        titel,
        ort,
        typ: select(findProp(p, ["Typ", "Kategorie"])),
        objektart: select(findProp(p, ["Objektart"])),
        nutzung: select(findProp(p, ["Nutzung"])),
        vermarktungsart,
        status: select(findProp(p, ["Status"])),
        preis,
        preisart,
        preisText: priceText(preis, preisart, vermarktungsart),
        flaeche: number(findProp(p, ["Fläche", "Flaeche", "Gesamtfläche", "Gesamtflaeche"])),
        wohnflaeche: number(findProp(p, ["Wohnfläche", "Wohnflaeche"])),
        grundstueck: number(findProp(p, ["Grundstück", "Grundstueck", "Grundstücksfläche", "Grundstuecksflaeche"])),
        zimmer: number(findProp(p, ["Zimmer"])),
        etage: String(etageRaw).trim() === "0" ? "Erdgeschoss" : etageRaw,
        lagerflaeche: number(findProp(p, ["Lagerfläche", "Lagerflaeche"])),
        teilbarAb: number(findProp(p, ["teilbar ab", "Teilbar ab", "Teilbar Ab"])),
        verfuegbarkeit: plain(findProp(p, ["Verfügbarkeit", "Verfuegbarkeit", "Bezugsfrei"])),
        baujahr: plain(findProp(p, ["Baujahr"])),
        energie: plain(findProp(p, ["Energie", "Energieausweis"])),
        stellplaetze: plain(findProp(p, ["Stellplätze", "Stellplaetze", "Parkplätze", "Parkplaetze"])),
        einheiten: plain(findProp(p, ["Einheiten"])),
        beschreibung: plain(findProp(p, ["Beschreibung", "Kurzbeschreibung", "Objektbeschreibung"])),
        highlights: plain(findProp(p, ["Highlights", "Highlights auf einen Blick", "Ausstattung"])),
        claim: plain(findProp(p, ["Claim", "Untertitel", "Slogan", "Kurztext"])),
        ansprechpartner: plain(findProp(p, ["Ansprechpartner", "Makler", "Kontaktperson"])) || "Christian Hoch",
        rolle: plain(findProp(p, ["Rolle", "Position", "Funktion"])) || "Geschäftsführer",
        telefon: plain(findProp(p, ["Telefon", "Phone", "Tel."])) || "+49 (0) 171 5744 947",
        email: plain(findProp(p, ["E-Mail", "Email", "Mail"])) || "c.hoch@friends-of-work.de",
        website: plain(findProp(p, ["Website", "Webseite", "URL"])) || "www.hoch-real-estate.de",
        anschrift: plain(findProp(p, ["Anschrift", "Adresse Büro", "Büro", "Firma Adresse"])) || "Emsstraße 18, 26135 Oldenburg",
        bilder
      };
    }

    function chunkWords(text, maxChars) {
      const source = String(text || "").replace(/\r/g, "").trim();
      if (!source) return [];
      const paragraphs = source.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
      const chunks = [];
      let current = "";

      for (const paragraph of paragraphs.length ? paragraphs : [source]) {
        if ((current + "\n\n" + paragraph).trim().length <= maxChars) {
          current = (current ? current + "\n\n" : "") + paragraph;
          continue;
        }
        if (current) chunks.push(current);
        if (paragraph.length <= maxChars) {
          current = paragraph;
        } else {
          const words = paragraph.split(/\s+/);
          current = "";
          for (const word of words) {
            if ((current + " " + word).trim().length > maxChars) {
              if (current) chunks.push(current);
              current = word;
            } else {
              current = (current ? current + " " : "") + word;
            }
          }
        }
      }
      if (current) chunks.push(current);
      return chunks;
    }

    function chunkArray(arr, size) {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    }

    const items = (data.results || []).map(mapPage).filter(i => i.titel);
    const obj = items.find(i => String(i.notionId) === requestedId || String(i.id) === requestedId);
    if (!obj) return res.status(404).send("Immobilie nicht gefunden.");

    const factRows = [
      ["Titel", obj.titel],
      ["Ort", obj.ort],
      ["Typ", obj.typ],
      ["Objektart", obj.objektart],
      ["Nutzung", obj.nutzung],
      ["Vermarktung", obj.vermarktungsart],
      ["Status", obj.status],
      ["Preis", obj.preisText],
      ["Preisart", obj.preisart],
      ["Fläche", formatArea(obj.flaeche)],
      ["Wohnfläche", formatArea(obj.wohnflaeche)],
      ["Grundstück", formatArea(obj.grundstueck)],
      ["Zimmer", obj.zimmer],
      ["Etage", obj.etage],
      ["Lagerfläche", formatArea(obj.lagerflaeche)],
      ["Teilbar ab", formatArea(obj.teilbarAb)],
      ["Verfügbarkeit", obj.verfuegbarkeit],
      ["Baujahr", obj.baujahr],
      ["Energie", obj.energie],
      ["Stellplätze", obj.stellplaetze],
      ["Einheiten", obj.einheiten]
    ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");

    const highlights = String(obj.highlights || "")
      .split(/\n|•|;/)
      .map(v => v.replace(/^[-–—]+/, "").trim())
      .filter(Boolean);

    const images = obj.bilder || [];
    const descriptionChunks = chunkWords(obj.beschreibung || "", 1450);
    if (!descriptionChunks.length) descriptionChunks.push("Weitere Informationen zu diesem Objekt stellen wir Ihnen gerne persönlich zur Verfügung.");

    const factChunks = chunkArray(factRows, 9);
    const imageChunks = images.length ? chunkArray(images, 6) : [];

    const factHtml = rows => rows.map(([label, value]) => `
      <div class="fact-card">
        <div class="fact-label">${esc(label)}</div>
        <div class="fact-value">${esc(value)}</div>
      </div>`).join("");

    const galleryHtml = imgs => imgs.map((src, i) => `
      <div class="object-image object-image-${i + 1}"><img src="${esc(src)}" alt="Objektbild ${i + 1}"></div>`).join("");

    const highlightsHtml = highlights.length ? `
      <div class="highlights-title">Highlights auf einen Blick</div>
      <ul class="highlights-list">${highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : "";

    const claimText = obj.claim || "Weitere Informationen erhalten Sie gerne auf Anfrage.";

    const descriptionPages = descriptionChunks.map((chunk, index) => `
<section class="page bg-plain description-page">
  <div class="page-kicker">${index === 0 ? esc(obj.vermarktungsart || "Exposé") : "Beschreibung"}</div>
  <div class="description-title ${index > 0 ? "description-title-small" : ""}">${index === 0 ? esc(obj.titel) : "Weitere Objektbeschreibung"}</div>
  <div class="description-copy ${index > 0 ? "description-copy-follow" : ""}">${nl2br(chunk)}</div>
  ${index === 0 ? highlightsHtml : ""}
  ${index === 0 ? `<div class="price-claim">${esc(claimText)}</div>
  <div class="price-box"><div class="price-main">${esc(obj.preisText)}</div><div class="price-type">${esc(obj.preisart || obj.vermarktungsart || "")}</div></div>` : ""}
</section>`).join("");

    const galleryPages = imageChunks.map((imgs, index) => `
<section class="page bg-plain gallery-page">
  <div class="section-label images-label">${index === 0 ? "Bilder" : `Weitere Bilder ${index + 1}`}</div>
  <div class="object-images count-${imgs.length}">${galleryHtml(imgs)}</div>
</section>`).join("");

    const factsPages = factChunks.map((rows, index) => `
<section class="page bg-plain facts-page">
  <div class="section-label facts-page-label">${index === 0 ? "Objektdaten" : `Weitere Objektdaten ${index + 1}`}</div>
  <div class="facts-grid facts-grid-full">${factHtml(rows)}</div>
</section>`).join("");

    const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(obj.titel)} – Exposé</title>
<style>
:root{
  --petrol:#00424a;
  --petrol2:#073f43;
  --gold:#C8A46B;
  --cream:#F7F4EF;
  --gray:#6b7280;
  --dark:#2B2B2B;
  --green:#214D40;
  --white:#ffffff;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#bfbfbf;color:var(--dark);font-family:Inter,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;margin:0 auto;background:var(--cream);page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
@page{size:A4;margin:0}
@media print{html,body{background:transparent}.page{margin:0}}
.bg-cover{background:url('/assets/expose-bg-cover.png') center/cover no-repeat}
.bg-plain{background:url('/assets/expose-bg-plain.png') center/cover no-repeat}
.bg-contact{background:url('/assets/expose-bg-contact.png') center/cover no-repeat}
.logo-cover{position:absolute;top:151px;left:50%;transform:translateX(-50%);width:330px;height:auto}
.cover-title{position:absolute;top:470px;left:0;width:100%;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:84px;line-height:.92;font-weight:700;color:#fff;letter-spacing:.015em}
.cover-object{position:absolute;top:640px;left:112px;width:calc(100% - 224px);text-align:center;color:#fff;font-size:21px;line-height:1.18;font-weight:900;text-transform:uppercase;letter-spacing:.018em;overflow:hidden;max-height:112px;text-wrap:balance}
.page-kicker{position:absolute;top:60px;left:74px;color:var(--gray);font-size:15px;letter-spacing:.16em;font-weight:900;text-transform:uppercase}
.description-title{position:absolute;top:104px;left:74px;width:590px;color:var(--green);font-family:Georgia,'Times New Roman',serif;font-size:41px;line-height:1.03;font-weight:700;letter-spacing:-.02em;text-transform:uppercase;text-wrap:balance}
.description-title-small{font-size:36px;top:108px}
.description-copy{position:absolute;top:252px;left:74px;width:590px;color:#202020;font-size:15.4px;line-height:1.32;font-weight:400;max-height:none;overflow:visible}
.description-copy-follow{top:190px;font-size:15.8px;line-height:1.38}
.highlights-title{position:absolute;top:645px;left:74px;width:590px;color:#202020;font-size:15px;line-height:1.2;font-weight:900}
.highlights-list{position:absolute;top:674px;left:93px;width:555px;margin:0;padding:0;color:#202020;font-size:12.5px;line-height:1.32;font-weight:400;max-height:135px;overflow:hidden}
.highlights-list li{margin-bottom:4px}
.price-claim{position:absolute;left:74px;bottom:104px;width:560px;color:#202020;font-weight:900;font-size:15px;line-height:1.2}
.price-box{position:absolute;left:74px;bottom:61px;display:flex;align-items:stretch;background:var(--petrol);color:#fff;height:43px;min-width:260px;max-width:590px;overflow:hidden}
.price-box .price-main{display:flex;align-items:center;padding:0 22px;font-size:18px;line-height:1.05;font-weight:400;white-space:nowrap}
.price-box .price-type{display:flex;align-items:center;padding:0 18px;border-left:1px solid rgba(255,255,255,.75);font-size:17px;line-height:1.05;font-weight:400;white-space:nowrap}
.section-label{position:absolute;left:74px;color:var(--gray);font-size:22px;line-height:1;font-weight:900;letter-spacing:.02em;text-transform:uppercase}
.images-label{top:96px}
.object-images{position:absolute;left:74px;right:74px;top:138px;height:750px;display:grid;gap:10px}
.object-images.count-0{display:none}
.object-images.count-1{grid-template-columns:1fr}
.object-images.count-2{grid-template-columns:repeat(2,1fr)}
.object-images.count-3{grid-template-columns:repeat(3,1fr)}
.object-images.count-4{grid-template:repeat(2,1fr)/repeat(2,1fr)}
.object-images.count-5{grid-template:1.1fr 1fr/1.35fr 1fr}
.object-images.count-5 .object-image-1{grid-row:1/3}
.object-images.count-6{grid-template:1.15fr 1fr/repeat(3,1fr)}
.object-images.count-6 .object-image-1{grid-column:1/3}
.object-image{overflow:hidden;background:#e8e2d8}
.object-image img{width:100%;height:100%;object-fit:cover;display:block}
.facts-page-label{top:96px}
.facts-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 11px}
.facts-grid-full{position:absolute;top:145px;left:74px;width:calc(100% - 148px)}
.fact-card{height:100px;border:1.5px solid var(--gold);background:rgba(247,244,239,.72);padding:15px 14px 10px;overflow:hidden}
.fact-label{color:var(--gray);font-size:8px;line-height:1;letter-spacing:.18em;font-weight:900;text-transform:uppercase;margin-bottom:13px}
.fact-value{color:var(--green);font-size:17px;line-height:1.12;font-weight:900;max-height:44px;overflow:hidden}
.contact-heading{position:absolute;top:96px;left:145px;right:145px;text-align:center;color:var(--petrol);font-family:Georgia,'Times New Roman',serif;font-size:50px;line-height:1.04;font-weight:700;letter-spacing:-.012em;text-transform:uppercase}
.contact-sub{position:absolute;top:405px;left:0;width:100%;text-align:center;color:var(--gray);font-size:27px;font-weight:900;letter-spacing:.005em;text-transform:uppercase}
.contact-logo{position:absolute;left:92px;bottom:85px;width:220px;height:auto}
.contact-name{position:absolute;left:445px;bottom:205px;color:var(--gold);font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:25px;line-height:1}
.contact-role{position:absolute;left:445px;bottom:184px;color:#fff;font-size:10px;font-weight:700;line-height:1;opacity:.95}
.contact-lines{position:absolute;left:445px;bottom:77px;width:250px;display:grid;gap:14px}
.contact-line{display:grid;grid-template-columns:26px 1fr;gap:13px;align-items:center;color:#fff;font-size:10px;line-height:1.2;font-weight:800}
.dot{width:24px;height:24px;border:1.3px solid var(--gold);border-radius:50%;position:relative;display:block}
.dot:after{content:"";position:absolute;left:9px;top:9px;width:4px;height:4px;border-radius:50%;background:var(--gold)}
</style>
</head>
<body data-expose-template="v9-professional-dynamic">
<section class="page bg-cover">
  <img class="logo-cover" src="/assets/hoch-logo-vertical.png" alt="HOCH Real Estate Advisory">
  <div class="cover-title">EXPOSÉ</div>
  <div class="cover-object">${esc(obj.titel)}</div>
</section>
${descriptionPages}
${galleryPages}
${factsPages}
<section class="page bg-contact">
  <div class="contact-heading">SIE HABEN<br>INTERESSE<br>AN DIESEM<br>OBJEKT?</div>
  <div class="contact-sub">WIR BERATEN SIE GERNE!</div>
  <img class="contact-logo" src="/assets/hoch-logo-vertical.png" alt="HOCH Real Estate Advisory">
  <div class="contact-name">${esc(obj.ansprechpartner)}</div>
  <div class="contact-role">${esc(obj.rolle)}</div>
  <div class="contact-lines">
    <div class="contact-line"><span class="dot"></span><span>${esc(obj.telefon)}</span></div>
    <div class="contact-line"><span class="dot"></span><span>${esc(obj.email)}</span></div>
    <div class="contact-line"><span class="dot"></span><span>${esc(obj.website)}</span></div>
    <div class="contact-line"><span class="dot"></span><span>${esc(obj.anschrift)}</span></div>
  </div>
</section>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send("Serverfehler: " + error.message);
  }
}
