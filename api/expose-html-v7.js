
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
    }

    function plain(prop) {
      if (!prop) return "";
      if (prop.type === "title") return (prop.title || []).map(t => t.plain_text || "").join("").trim();
      if (prop.type === "rich_text") return (prop.rich_text || []).map(t => t.plain_text || "").join("").trim();
      if (prop.type === "select") return prop.select?.name || "";
      if (prop.type === "multi_select") return (prop.multi_select || []).map(s => s.name).join(", ");
      if (prop.type === "number") return prop.number ?? "";
      if (prop.type === "date") return prop.date?.start || "";
      if (prop.type === "url") return prop.url || "";
      if (prop.type === "email") return prop.email || "";
      if (prop.type === "phone_number") return prop.phone_number || "";
      if (prop.type === "checkbox") return prop.checkbox ? "true" : "";
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

    function priceText(preis, preisart, vermarktungsart) {
      const art = String(preisart || "").toLowerCase();
      const verm = String(vermarktungsart || "").toLowerCase();
      const miet = verm.includes("miete") ? " Miete" : "";
      if (art.includes("anfrage") || preis === null || preis === undefined || preis === "") return "auf Anfrage";
      if (art.includes("m²") || art.includes("m2") || art.includes("qm") || art.includes("pro")) return `${formatNumber(preis)} €/m²${miet}`;
      return `${formatNumber(preis)} €${miet}`;
    }

    function mapPage(page, index) {
      const p = page.properties || {};
      const titel = plain(findProp(p, ["Titel", "Name"]));
      const ort = plain(findProp(p, ["Ort", "Adresse", "Standort"]));
      const vermarktungsart = select(findProp(p, ["Vermarktungsart", "Vermarktung"]));
      const preis = number(findProp(p, ["Preis"]));
      const preisart = select(findProp(p, ["Preisart", "Preistyp", "Preis Typ"]));
      const etageRaw = plain(findProp(p, ["Etage(n)", "Etagen", "Etage"]));
      const bilder = [...new Set([...files(findProp(p, ["Bild", "Bilder", "Foto", "Fotos"])), cover(page)].filter(Boolean))];
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
        flaeche: number(findProp(p, ["Fläche", "Flaeche"])),
        zimmer: number(findProp(p, ["Zimmer"])),
        etage: String(etageRaw).trim() === "0" ? "Erdgeschoss" : etageRaw,
        lagerflaeche: number(findProp(p, ["Lagerfläche", "Lagerflaeche"])),
        teilbarAb: number(findProp(p, ["teilbar ab", "Teilbar ab", "Teilbar Ab"])),
        verfuegbarkeit: plain(findProp(p, ["Verfügbarkeit", "Verfuegbarkeit", "Bezugsfrei"])),
        baujahr: plain(findProp(p, ["Baujahr"])),
        energie: plain(findProp(p, ["Energie", "Energieausweis"])),
        beschreibung: plain(findProp(p, ["Beschreibung", "Kurzbeschreibung"])),
        highlights: plain(findProp(p, ["Highlights", "Highlights auf einen Blick"])),
        bilder
      };
    }

    const items = (data.results || []).map(mapPage).filter(i => i.titel);
    const obj = items.find(i => String(i.notionId) === requestedId || String(i.id) === requestedId);
    if (!obj) return res.status(404).send("Immobilie nicht gefunden.");

    const factRows = [
      ["Titel", obj.titel], ["Ort", obj.ort], ["Typ", obj.typ], ["Objektart", obj.objektart],
      ["Nutzung", obj.nutzung], ["Vermarktung", obj.vermarktungsart], ["Status", obj.status],
      ["Preis", obj.preisText], ["Preisart", obj.preisart],
      ["Fläche", obj.flaeche ? `${formatNumber(obj.flaeche)} m²` : ""],
      ["Zimmer", obj.zimmer], ["Etage", obj.etage],
      ["Lagerfläche", obj.lagerflaeche ? `${formatNumber(obj.lagerflaeche)} m²` : ""],
      ["Teilbar ab", obj.teilbarAb ? `${formatNumber(obj.teilbarAb)} m²` : ""],
      ["Verfügbarkeit", obj.verfuegbarkeit], ["Baujahr", obj.baujahr], ["Energie", obj.energie]
    ].filter(([,v]) => v !== null && v !== undefined && String(v).trim() !== "").slice(0, 12);

    const highlights = String(obj.highlights || "").split(/\n|•/).map(v => v.replace(/^-/, "").trim()).filter(Boolean).slice(0, 8);
    const images = (obj.bilder || []).slice(0, 12);
    const galleryCount = Math.min(images.length, 6);
    const secondImages = images.length > 6 ? images.slice(6, 12) : images.slice(0, 6);
    const secondCount = Math.min(secondImages.length, 6);

    const factHtml = factRows.map(([l,v]) => `<div class="fact-card"><div class="fact-label">${esc(l)}</div><div class="fact-value">${esc(v)}</div></div>`).join("");
    const highlightsHtml = highlights.length ? `<div class="highlights-title">Highlights auf einen Blick</div><ul class="highlights-list">${highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : "";
    const galleryHtml = images.slice(0, 6).map((src, i) => `<div class="gallery-item gallery-item-${i+1}"><img src="${esc(src)}"></div>`).join("");
    const secondGalleryHtml = secondImages.slice(0, 6).map((src, i) => `<div class="object-image object-image-${i+1}"><img src="${esc(src)}"></div>`).join("");

    const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(obj.titel)} – Exposé V7</title>
<style>
:root{--petrol:#004f54;--petrol-dark:#00424a;--gold:#C8A46B;--cream:#f7f4ef;--gray:#6b7280;--dark:#292929;--line:#caa86d;--white:#fff}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#bfbfbf;color:var(--dark);font-family:Inter,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:794px;height:1123px;position:relative;overflow:hidden;margin:0 auto 18px;background:var(--cream);page-break-after:always}
@page{size:A4;margin:0}
@media print{body{background:transparent}.page{width:210mm;height:297mm;margin:0}.screen-hint{display:none!important}}
.bg-cover{background:url('/assets/expose-bg-cover.png') center/cover no-repeat}.bg-plain{background:url('/assets/expose-bg-plain.png') center/cover no-repeat}.bg-contact{background:url('/assets/expose-bg-contact.png') center/cover no-repeat}
.screen-hint{position:fixed;right:18px;bottom:18px;z-index:1000;background:#00424a;color:#fff;border:1px solid rgba(200,164,107,.65);border-radius:999px;padding:12px 18px;font-size:13px;font-weight:800;text-decoration:none;box-shadow:0 12px 28px rgba(0,0,0,.22)}
/* Seite 1 */
.logo-cover{position:absolute;top:270px;left:50%;transform:translateX(-50%);width:410px;height:auto}.cover-title{position:absolute;top:708px;left:0;width:100%;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:84px;line-height:.95;font-weight:700;color:#fff;letter-spacing:.02em}.cover-object{position:absolute;top:852px;left:150px;width:494px;text-align:center;color:#fff;font-size:28px;line-height:1.12;font-weight:900;text-transform:uppercase;letter-spacing:.02em}.cover-location{position:absolute;top:918px;left:150px;width:494px;text-align:center;color:#fff;font-size:23px;line-height:1.15;font-weight:900;text-transform:uppercase;letter-spacing:.01em}
/* Seite 2 */
.kicker{position:absolute;left:80px;top:66px;color:var(--gray);font-size:22px;letter-spacing:.11em;font-weight:900;text-transform:uppercase}.description-title{position:absolute;left:80px;top:114px;width:650px;color:#284735;font-family:Georgia,'Times New Roman',serif;font-size:49px;line-height:1.05;font-weight:900;letter-spacing:-.02em;text-transform:uppercase}.description-copy{position:absolute;left:80px;top:278px;width:620px;max-height:420px;overflow:hidden;color:#27272a;font-size:18px;line-height:1.34;font-weight:400}.description-copy b{font-weight:900}.highlights-title{position:absolute;left:80px;top:735px;width:620px;color:#27272a;font-size:18px;line-height:1.2;font-weight:900}.highlights-list{position:absolute;left:97px;top:764px;width:610px;margin:0;padding:0;color:#27272a;font-size:17px;line-height:1.28;font-weight:400}.highlights-list li{margin:0 0 2px}.closing-line{position:absolute;left:80px;top:955px;width:620px;color:#27272a;font-size:17px;line-height:1.2;font-weight:900}.price-box{position:absolute;left:80px;top:1002px;width:260px;height:48px;background:#004f54;color:#fff;display:grid;grid-template-columns:1fr 1px 1fr;align-items:center;text-align:center;font-size:22px;line-height:1;font-weight:500}.price-separator{height:28px;background:rgba(255,255,255,.75)}
/* Seite 3 */
.section-label{position:absolute;left:80px;color:var(--gray);font-size:22px;line-height:1;font-weight:900;text-transform:uppercase}.bilder-label{top:119px}.image-grid{position:absolute;left:80px;top:150px;width:635px;height:460px;display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:310px 143px;gap:7px}.image-grid.count-0{display:none}.image-grid.count-1{display:block}.image-grid.count-1 .image-slot{position:absolute;inset:0}.image-grid.count-2{grid-template-columns:1fr 1fr;grid-template-rows:1fr}.image-grid.count-3{grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr}.image-grid.count-4 .image-slot-1{grid-column:1/4}.image-grid.count-5{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}.image-grid.count-6{grid-template-columns:1fr 1fr 1fr;grid-template-rows:225px 225px}.image-grid.count-4 .image-slot-1,.image-grid.count-5 .image-slot-1,.image-grid.count-6 .image-slot-1{grid-column:1/4}.image-slot{overflow:hidden;background:#e8e2d8}.image-slot img{width:100%;height:100%;object-fit:cover;display:block}.daten-label{top:667px}.facts-grid{position:absolute;left:80px;top:704px;width:635px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px 10px}.fact-card{height:94px;border:2px solid var(--line);background:rgba(247,244,239,.65);padding:16px 14px 10px;display:flex;flex-direction:column;justify-content:center}.fact-label{color:var(--gray);font-size:10px;line-height:1;letter-spacing:.13em;font-weight:900;text-transform:uppercase;margin-bottom:10px}.fact-value{color:#284735;font-size:20px;line-height:1.08;font-weight:900;max-height:45px;overflow:hidden}
/* Seite 4 */
.contact-heading{position:absolute;top:148px;left:150px;width:500px;text-align:center;color:#004f54;font-family:Georgia,'Times New Roman',serif;font-size:61px;line-height:1.28;font-weight:900;letter-spacing:.005em;text-transform:uppercase}.contact-sub{position:absolute;top:590px;left:0;width:100%;text-align:center;color:var(--gray);font-size:31px;font-weight:900;text-transform:uppercase}.contact-logo{position:absolute;left:101px;bottom:74px;width:235px;height:auto}.contact-name{position:absolute;left:460px;bottom:288px;color:var(--gold);font-family:Georgia,'Times New Roman',serif;font-weight:900;font-size:28px;line-height:1}.contact-role{position:absolute;left:460px;bottom:264px;color:#fff;font-family:Georgia,'Times New Roman',serif;font-size:14px}.contact-lines{position:absolute;left:460px;bottom:99px;width:278px;display:grid;gap:18px}.contact-line{display:grid;grid-template-columns:34px 1fr;gap:15px;align-items:center;color:#fff;font-size:14px;line-height:1.2;font-weight:900}.dot{width:31px;height:31px;border:1.5px solid var(--gold);border-radius:50%;position:relative}.dot:after{content:"";position:absolute;left:12px;top:12px;width:5px;height:5px;border-radius:50%;background:var(--gold)}
</style>
</head>
<body data-expose-template="v7-canva-closer">
<a class="screen-hint" href="javascript:window.print()">Als PDF speichern / drucken</a>
<section class="page bg-cover"><img class="logo-cover" src="/assets/hoch-logo-vertical.png"><div class="cover-title">EXPOSÉ</div><div class="cover-object">${esc(obj.titel)}</div><div class="cover-location">${esc(obj.ort)}</div></section>
<section class="page bg-plain"><div class="kicker">(${esc(obj.vermarktungsart || 'VERMARKTUNGSART')})</div><div class="description-title">${esc(obj.titel)}</div><div class="description-copy"><b>(${esc('BESCHREIBUNG')})</b> ${nl2br(obj.beschreibung)}</div>${highlightsHtml}<div class="closing-line">Erlebe urbanes Wohnen neu!</div><div class="price-box"><span>${esc(obj.preisText)}</span><span class="price-separator"></span><span>${esc(obj.preisart || obj.vermarktungsart || 'ART')}</span></div></section>
<section class="page bg-plain"><div class="section-label bilder-label">(BILDER)</div><div class="image-grid count-${galleryCount}">${galleryHtml.replaceAll('gallery-item','image-slot').replaceAll('gallery-item-','image-slot-')}</div><div class="section-label daten-label">(OBJEKTDATEN)</div><div class="facts-grid">${factHtml}</div></section>
<section class="page bg-contact"><div class="contact-heading">SIE HABEN<br>INTERESSE<br>AN DIESEM<br>OBJEKT?</div><div class="contact-sub">WIR BERATEN SIE GERNE!</div><img class="contact-logo" src="/assets/hoch-logo-vertical.png"><div class="contact-name">Christian Hoch</div><div class="contact-role">Geschäftsführer</div><div class="contact-lines"><div class="contact-line"><span class="dot"></span><span>+49 (0) 171 5744 947</span></div><div class="contact-line"><span class="dot"></span><span>c.hoch@friends-of-work.de</span></div><div class="contact-line"><span class="dot"></span><span>www.hoch-real-estate.de</span></div><div class="contact-line"><span class="dot"></span><span>Emsstraße 18, 26135 Oldenburg</span></div></div></section>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send("Serverfehler: " + error.message);
  }
}
