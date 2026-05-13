
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
<title>${esc(obj.titel)} – Exposé</title>
<style>
:root{--petrol:#00424a;--gold:#C8A46B;--cream:#F7F4EF;--gray:#6b7280;--dark:#2B2B2B;--line:#e0d8ca;--white:#fff}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#bbb;color:var(--dark);font-family:Inter,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;margin:0 auto 18px;background:var(--cream);page-break-after:always}
@page{size:A4;margin:0}
@media print{body{background:transparent}.page{margin:0}}
.bg-cover{background:url('/assets/expose-bg-cover.png') center/cover no-repeat}
.bg-plain{background:url('/assets/expose-bg-plain.png') center/cover no-repeat}
.bg-contact{background:url('/assets/expose-bg-contact.png') center/cover no-repeat}
.logo-cover{position:absolute;top:206px;left:50%;transform:translateX(-50%);width:282px}
.cover-title{position:absolute;top:548px;left:0;width:100%;text-align:center;font-family:Georgia,serif;font-size:76px;line-height:.95;font-weight:700;color:#fff;letter-spacing:.02em}
.cover-object{position:absolute;top:680px;left:90px;width:calc(100% - 180px);text-align:center;color:#fff;font-size:20px;line-height:1.28;font-weight:700;text-transform:uppercase}
.cover-location{position:absolute;top:748px;left:90px;width:calc(100% - 180px);text-align:center;color:#fff;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.03em}
.page-label{position:absolute;top:54px;left:58px;color:var(--gold);font-size:10px;letter-spacing:.22em;font-weight:700;text-transform:uppercase}
.description-title{position:absolute;top:96px;left:58px;width:350px;color:var(--petrol);font-family:Georgia,serif;font-size:34px;line-height:1.05;font-weight:700;text-transform:uppercase}
.description-location{position:absolute;top:176px;left:58px;width:330px;color:var(--gray);font-size:12px;line-height:1.35;font-weight:600}
.description-copy{position:absolute;top:225px;left:58px;width:360px;max-height:380px;overflow:hidden;color:var(--dark);font-size:12.1px;line-height:1.55}
.highlights-title{position:absolute;top:632px;left:58px;width:360px;color:var(--petrol);font-size:14px;font-weight:800}
.highlights-list{position:absolute;top:660px;left:74px;width:345px;margin:0;padding:0;color:var(--dark);font-size:11.4px;line-height:1.45}
.highlights-list li{margin-bottom:5px}
.price-line{position:absolute;left:58px;bottom:66px;display:flex;align-items:baseline;gap:18px;color:var(--gold);font-weight:800}
.price-line .price{font-size:22px;line-height:1}
.price-line .type{color:var(--gray);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.side-gallery{position:absolute;right:58px;top:96px;width:205px;height:650px;display:grid;gap:9px}
.side-gallery.gallery-0{display:none}.gallery-item,.object-image{overflow:hidden;background:#e8e2d8}.gallery-item img,.object-image img{width:100%;height:100%;object-fit:cover;display:block}
.gallery-1{grid-template:1fr/1fr}.gallery-2{grid-template:1fr 1fr/1fr}.gallery-3{grid-template:1.25fr 1fr/1fr 1fr}.gallery-3 .gallery-item-1{grid-column:1/3}.gallery-4{grid-template:1fr 1fr/1fr 1fr}.gallery-5{grid-template:repeat(4,1fr)/1.35fr 1fr}.gallery-5 .gallery-item-1{grid-row:1/5}.gallery-6{grid-template:repeat(3,1fr)/1fr 1fr}
.small-footer{position:absolute;right:58px;bottom:48px;width:205px;text-align:right;color:var(--gray);font-size:8px}
.object-title{position:absolute;top:68px;left:58px;color:var(--petrol);font-family:Georgia,serif;font-size:46px;line-height:.95;font-weight:700;text-transform:uppercase}
.gold-rule{position:absolute;top:142px;left:58px;width:calc(100% - 116px);height:2px;background:var(--gold)}
.facts-grid{position:absolute;top:184px;left:58px;width:calc(100% - 116px);display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.fact-card{height:69px;border:1px solid var(--line);background:rgba(247,244,239,.92);border-radius:6px;padding:13px 13px 10px}
.fact-label{color:var(--gold);font-size:8px;letter-spacing:.18em;font-weight:800;text-transform:uppercase;margin-bottom:12px}
.fact-value{color:var(--petrol);font-size:14px;line-height:1.15;font-weight:800}
.object-images{position:absolute;left:58px;right:58px;bottom:66px;height:330px;display:grid;gap:11px;grid-template-columns:repeat(2,1fr)}
.object-images.count-0{display:none}.object-images.count-1{grid-template-columns:1fr}.object-images.count-2{grid-template-columns:repeat(2,1fr)}.object-images.count-3{grid-template:1fr 1fr/1.3fr 1fr}.object-images.count-3 .object-image-1{grid-row:1/3}.object-images.count-4{grid-template:repeat(2,1fr)/repeat(2,1fr)}.object-images.count-5{grid-template:repeat(4,1fr)/1.35fr 1fr}.object-images.count-5 .object-image-1{grid-row:1/5}.object-images.count-6{grid-template:repeat(2,1fr)/repeat(3,1fr)}
.contact-heading{position:absolute;top:108px;left:80px;right:80px;text-align:center;color:var(--petrol);font-family:Georgia,serif;font-size:48px;line-height:1.08;font-weight:700;text-transform:uppercase}
.contact-sub{position:absolute;top:445px;left:0;width:100%;text-align:center;color:var(--gray);font-size:22px;font-weight:800;text-transform:uppercase}
.contact-logo{position:absolute;left:78px;bottom:74px;width:210px}
.contact-name{position:absolute;left:455px;bottom:188px;color:var(--gold);font-family:Georgia,serif;font-weight:700;font-size:25px}
.contact-role{position:absolute;left:455px;bottom:166px;color:#fff;font-family:Georgia,serif;font-size:13px}
.contact-lines{position:absolute;left:455px;bottom:66px;width:235px;display:grid;gap:11px}.contact-line{display:grid;grid-template-columns:24px 1fr;gap:12px;align-items:center;color:#fff;font-size:10.8px;line-height:1.2;font-weight:800}
.dot{width:22px;height:22px;border:1.5px solid var(--gold);border-radius:50%;position:relative}.dot:after{content:"";position:absolute;left:8px;top:8px;width:4px;height:4px;border-radius:50%;background:var(--gold)}
</style>
</head>
<body>
<section class="page bg-cover"><img class="logo-cover" src="/assets/hoch-logo-vertical.png"><div class="cover-title">EXPOSÉ</div><div class="cover-object">${esc(obj.titel)}</div><div class="cover-location">${esc(obj.ort)}</div></section>
<section class="page bg-plain"><div class="page-label">EXPOSÉ</div><div class="description-title">${esc(obj.titel)}</div><div class="description-location">${esc(obj.ort)}</div><div class="description-copy">${nl2br(obj.beschreibung)}</div>${highlightsHtml}<div class="price-line"><span class="price">${esc(obj.preisText)}</span><span class="type">${esc(obj.preisart || obj.vermarktungsart || "")}</span></div><div class="side-gallery gallery-${galleryCount}">${galleryHtml}</div><div class="small-footer">HOCH Real Estate Advisory</div></section>
<section class="page bg-plain"><div class="object-title">OBJEKTDATEN</div><div class="gold-rule"></div><div class="facts-grid">${factHtml}</div><div class="object-images count-${secondCount}">${secondGalleryHtml}</div></section>
<section class="page bg-contact"><div class="contact-heading">SIE HABEN<br>INTERESSE<br>AN DIESEM<br>OBJEKT?</div><div class="contact-sub">WIR BERATEN SIE GERNE!</div><img class="contact-logo" src="/assets/hoch-logo-vertical.png"><div class="contact-name">Christian Hoch</div><div class="contact-role">Geschäftsführer</div><div class="contact-lines"><div class="contact-line"><span class="dot"></span><span>+49 (0) 171 5744 947</span></div><div class="contact-line"><span class="dot"></span><span>c.hoch@friends-of-work.de</span></div><div class="contact-line"><span class="dot"></span><span>www.hoch-real-estate.de</span></div><div class="contact-line"><span class="dot"></span><span>Emsstraße 18, 26135 Oldenburg</span></div></div></section>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send("Serverfehler: " + error.message);
  }
}
