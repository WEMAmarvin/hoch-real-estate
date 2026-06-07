
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
      const bilder = [...new Set([...files(findProp(p, ["Bild", "Bilder", "Foto", "Fotos", "Galerie", "Exposé Bilder"])), cover(page)].filter(Boolean))];
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
        beschreibung: plain(findProp(p, ["Beschreibung", "Kurzbeschreibung", "Objektbeschreibung"])),
        highlights: plain(findProp(p, ["Highlights", "Highlights auf einen Blick", "Ausstattung"])),
        claim: plain(findProp(p, ["Claim", "Untertitel", "Slogan", "Kurztext"])),
        ansprechpartner: plain(findProp(p, ["Ansprechpartner", "Makler", "Kontaktperson"])) || "Christian Hoch",
        rolle: plain(findProp(p, ["Rolle", "Position", "Funktion"])) || "Geschäftsführer",
        telefon: plain(findProp(p, ["Telefon", "Phone", "Tel."])) || "+49 (0) 171 5744 947",
        email: plain(findProp(p, ["E-Mail", "Email", "Mail"])) || "christian@hoch-real-estate.de",
        website: plain(findProp(p, ["Website", "Webseite", "URL"])) || "www.hoch-real-estate.de",
        anschrift: plain(findProp(p, ["Anschrift", "Adresse Büro", "Büro", "Firma Adresse"])) || "Emsstraße 18, 26135 Oldenburg",
        bilder
      };
    }

    const items = (data.results || []).map(mapPage).filter(i => i.titel);
    const obj = items.find(i => String(i.notionId) === requestedId || String(i.id) === requestedId);
    if (!obj) return res.status(404).send("Immobilie nicht gefunden.");

    function valOrDash(v) {
      return v === null || v === undefined || String(v).trim() === "" ? "—" : String(v).trim();
    }

    function areaText(v) {
      return v ? `${formatNumber(v)} m²` : "—";
    }

    const factRows = [
      ["Typ", obj.typ || obj.objektart || obj.nutzung],
      ["Ort", obj.ort],
      ["Vermarktung", obj.vermarktungsart],
      ["Preis", obj.preisText],
      ["Fläche", areaText(obj.flaeche)],
      ["Zimmer", obj.zimmer],
      ["Etage", obj.etage],
      ["Lagerfläche", areaText(obj.lagerflaeche)],
      ["Teilbar ab", areaText(obj.teilbarAb)]
    ].map(([l, v]) => [l, valOrDash(v)]);

    function autoHighlights(o) {
      const out = [];
      const type = String(o.typ || o.objektart || "").toLowerCase();
      const verm = String(o.vermarktungsart || "").toLowerCase();
      if (o.ort) out.push(`Attraktive Lage in ${o.ort}`);
      if (o.flaeche) out.push(`${formatNumber(o.flaeche)} m² flexibel nutzbare Fläche`);
      if (o.zimmer) out.push(`${formatNumber(o.zimmer)} Räume / Nutzungseinheiten`);
      if (o.lagerflaeche) out.push(`${formatNumber(o.lagerflaeche)} m² zusätzliche Lagerfläche`);
      if (o.teilbarAb) out.push(`Teilbar ab ${formatNumber(o.teilbarAb)} m²`);
      if (type.includes("büro") || type.includes("workspace")) out.push("Geeignet für Büro, Beratung und moderne Arbeitskonzepte");
      else if (type.includes("laden") || type.includes("retail")) out.push("Sichtbare Gewerbefläche mit vielseitigen Nutzungsmöglichkeiten");
      else if (type.includes("halle") || type.includes("lager")) out.push("Praktische Flächenstruktur für Lager und Logistik");
      else out.push("Vielseitiges Objekt mit professionellem Nutzungspotenzial");
      if (verm) out.push(`${o.vermarktungsart} als klare Vermarktungsoption`);
      return [...new Set(out)].slice(0, 7);
    }

    const manualHighlights = String(obj.highlights || "")
      .split(/\n|•/)
      .map(v => v.replace(/^-/, "").trim())
      .filter(Boolean);
    const highlights = (manualHighlights.length ? manualHighlights : autoHighlights(obj)).slice(0, 7);

    const descriptionLength = String(obj.beschreibung || "").length;
    const descClass = descriptionLength > 2600 ? "xlong" : (descriptionLength > 2000 ? "long" : (descriptionLength > 1400 ? "medium" : "short"));
    const titleClass = String(obj.titel || "").length > 58 ? "title-tight" : (String(obj.titel || "").length > 42 ? "title-medium" : "title-short");
    const images = (obj.bilder || []).filter(Boolean);
    const pageImages = images.slice(0, 4);
    const imageSlots = [0, 1, 2, 3].map(i => pageImages[i] || "");

    const factHtml = factRows.map(([l,v]) => `<div class="fact-card"><div class="fact-label">${esc(l)}</div><div class="fact-value">${esc(v)}</div></div>`).join("");
    const highlightsHtml = highlights.length ? `<div class="highlights-title">Highlights auf einen Blick</div><ul class="highlights-list">${highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : "";
    const secondGalleryHtml = imageSlots.map((src, i) => `<div class="object-image object-image-${i+1}${src ? "" : " placeholder"}">${src ? `<img src="${esc(src)}">` : `<span>Bild ${i+1}</span>`}</div>`).join("");

    const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(obj.titel)} – Exposé V11</title>
<style>
:root{
  --petrol:#00424a;
  --petrol2:#073f43;
  --gold:#C8A46B;
  --cream:#F7F4EF;
  --gray:#6b7280;
  --dark:#2B2B2B;
  --white:#ffffff;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#bfbfbf;color:var(--dark);font-family:Inter,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;margin:0 auto;background:var(--cream);page-break-after:always}
.page:last-child{page-break-after:auto}
@page{size:A4;margin:0}
@media print{html,body{background:transparent}.page{margin:0}}
.bg-cover{background:url('/assets/expose-bg-cover.png') center/cover no-repeat}
.bg-plain{background:url('/assets/expose-bg-plain.png') center/cover no-repeat}
.bg-contact{background:url('/assets/expose-bg-contact.png') center/cover no-repeat}
.logo-cover{position:absolute;top:190px;left:50%;transform:translateX(-50%);width:382px;height:auto}
.cover-title{position:absolute;top:600px;left:0;width:100%;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:74px;line-height:.92;font-weight:700;color:#fff;letter-spacing:.015em}
.cover-object{position:absolute;top:740px;left:112px;width:calc(100% - 224px);text-align:center;color:#fff;font-size:19px;line-height:1.14;font-weight:900;text-transform:uppercase;letter-spacing:.018em;overflow:hidden;max-height:72px;text-wrap:balance}
.cover-location{position:absolute;top:810px;left:112px;width:calc(100% - 224px);text-align:center;color:#fff;font-size:17px;line-height:1.15;font-weight:900;text-transform:uppercase;letter-spacing:.012em;overflow:hidden;max-height:44px}
/* Seite 2 */
.page-kicker{position:absolute;top:62px;left:74px;color:var(--gray);font-size:19px;letter-spacing:.16em;font-weight:900;text-transform:uppercase}
.description-title{position:absolute;top:108px;left:74px;width:620px;color:#214D40;font-family:Georgia,'Times New Roman',serif;font-size:46px;line-height:1.04;font-weight:700;letter-spacing:-.02em;text-transform:uppercase;text-wrap:balance;max-height:150px;overflow:hidden}
.description-title.title-medium{font-size:41px;line-height:1.02}
.description-title.title-tight{font-size:36px;line-height:1.01}
.description-copy{position:absolute;top:268px;left:74px;width:615px;max-height:415px;overflow:hidden;color:#202020;font-size:17px;line-height:1.34;font-weight:400}
.description-copy.medium{font-size:15.5px;line-height:1.27;max-height:420px}
.description-copy.long{font-size:14px;line-height:1.18;max-height:425px}
.description-copy.xlong{font-size:13px;line-height:1.12;max-height:430px}
.highlights-title{position:absolute;top:710px;left:74px;width:615px;color:#202020;font-size:17px;line-height:1.2;font-weight:900}
.highlights-list{position:absolute;top:737px;left:93px;width:585px;margin:0;padding:0;color:#202020;font-size:14px;line-height:1.28;font-weight:400}
.highlights-list li{margin-bottom:3px}
.price-claim{position:absolute;left:74px;bottom:116px;color:#202020;font-weight:900;font-size:17px}
.price-claim:empty{display:none}
.price-box{position:absolute;left:74px;bottom:62px;display:flex;align-items:stretch;background:var(--petrol);color:#fff;height:53px;min-width:260px;max-width:560px;overflow:hidden}
.price-box .price-main{display:flex;align-items:center;padding:0 27px;font-size:23px;line-height:1.05;font-weight:400;white-space:nowrap}
.price-box .price-type{display:flex;align-items:center;padding:0 24px;border-left:1px solid rgba(255,255,255,.75);font-size:22px;line-height:1.05;font-weight:400;white-space:nowrap}
/* Seite 3 */
.section-label{position:absolute;left:74px;color:var(--gray);font-size:22px;line-height:1;font-weight:900;letter-spacing:.02em;text-transform:uppercase}
.images-label{top:116px}
.facts-label{top:665px}
.object-images{position:absolute;left:74px;right:74px;top:155px;height:460px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:305px 145px;gap:8px}
.object-image{overflow:hidden;background:#ebe7df;position:relative}
.object-image-1{grid-column:1/4;grid-row:1}
.object-image-2{grid-column:1;grid-row:2}
.object-image-3{grid-column:2;grid-row:2}
.object-image-4{grid-column:3;grid-row:2}
.object-image img{width:100%;height:100%;object-fit:cover;display:block}
.object-image.placeholder{border:1px solid rgba(200,164,107,.35);display:flex;align-items:center;justify-content:center;color:rgba(107,114,128,.55);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.facts-grid{position:absolute;top:705px;left:74px;width:calc(100% - 148px);display:grid;grid-template-columns:repeat(3,1fr);gap:10px 11px}
.fact-card{height:94px;border:1.5px solid var(--gold);background:rgba(247,244,239,.72);padding:15px 14px 10px;overflow:hidden}
.fact-label{color:var(--gray);font-size:8px;line-height:1;letter-spacing:.18em;font-weight:900;text-transform:uppercase;margin-bottom:15px}
.fact-value{color:#214D40;font-size:17px;line-height:1.1;font-weight:900;max-height:42px;overflow:hidden}
/* Seite 4 */
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
<body data-expose-template="v11-canva-pixel-locked">
<section class="page bg-cover">
  <img class="logo-cover" src="/assets/hoch-logo-vertical.png" alt="HOCH Real Estate Advisory">
  <div class="cover-title">EXPOSÉ</div>
  <div class="cover-object">${esc(obj.titel)}</div>
  <div class="cover-location">${esc(obj.ort)}</div>
</section>
<section class="page bg-plain">
  <div class="page-kicker">${esc(obj.vermarktungsart || 'Exposé')}</div>
  <div class="description-title ${titleClass}">${esc(obj.titel)}</div>
  <div class="description-copy ${descClass}">${nl2br(obj.beschreibung)}</div>
  ${highlightsHtml}
  <div class="price-claim">${esc(obj.claim || (String(obj.typ || obj.objektart || "").toLowerCase().includes("wohnen") ? "Erlebe urbanes Wohnen neu!" : "Ihre Gewerbefläche auf einen Blick"))}</div>
  <div class="price-box"><div class="price-main">${esc(obj.preisText)}</div><div class="price-type">${esc(obj.preisart || obj.vermarktungsart || '')}</div></div>
</section>
<section class="page bg-plain">
  <div class="section-label images-label">Bilder</div>
  <div class="object-images">${secondGalleryHtml}</div>
  <div class="section-label facts-label">Objektdaten</div>
  <div class="facts-grid">${factHtml}</div>
</section>
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
