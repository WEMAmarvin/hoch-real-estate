export default async function handler(req, res) {
  try {
    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID || "34fa4c6888f080c8b2f0f54e1dd714a5";

    if (!notionToken) {
      return res.status(500).json({ error: "NOTION_TOKEN fehlt in den Environment Variables." });
    }

    if (req.method && req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Methode nicht erlaubt." });
    }

    const notionHeaders = {
      "Authorization": `Bearer ${notionToken}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    };

    async function queryNotionDatabase() {
      const results = [];
      let startCursor = undefined;

      do {
        const notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
          method: "POST",
          headers: notionHeaders,
          body: JSON.stringify({
            page_size: 100,
            start_cursor: startCursor,
            sorts: [{ timestamp: "created_time", direction: "descending" }]
          })
        });

        if (!notionRes.ok) {
          const text = await notionRes.text();
          const error = new Error("Notion API Fehler");
          error.statusCode = notionRes.status;
          error.details = text;
          throw error;
        }

        const pageData = await notionRes.json();
        results.push(...(pageData.results || []));
        startCursor = pageData.has_more ? pageData.next_cursor : undefined;
      } while (startCursor);

      return results;
    }

    const notionPages = await queryNotionDatabase();

    function findProp(props, names) {
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(props, name)) return props[name];
      }
      return undefined;
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, m => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[m]));
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

    function safeHref(url) {
      const href = String(url || "").trim();
      if (!href) return "";
      if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
      return "";
    }

    function richTextHtml(prop) {
      if (!prop || prop.type !== "rich_text") return "";

      return (prop.rich_text || []).map(part => {
        let text = escapeHtml(part.plain_text || "");
        const annotations = part.annotations || {};

        if (annotations.code) text = `<code>${text}</code>`;
        if (annotations.bold) text = `<strong>${text}</strong>`;
        if (annotations.italic) text = `<em>${text}</em>`;
        if (annotations.underline) text = `<u>${text}</u>`;
        if (annotations.strikethrough) text = `<s>${text}</s>`;

        const href = safeHref(part.href);
        if (href) {
          text = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        }

        return text;
      }).join("").trim();
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

      // Fallback, falls Bild versehentlich als URL- oder Textfeld angelegt ist.
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

    const items = notionPages.map((page, index) => {
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

      const beschreibungProp = findProp(p, ["Beschreibung", "Kurzbeschreibung"]);
      const beschreibung = plain(beschreibungProp);
      const beschreibungHtml = richTextHtml(beschreibungProp);

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
        beschreibungHtml,
        bild: bilder[0] || "",
        bilder
      };
    }).filter(item => item.titel);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(items);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message, details: error.details || "" });
    }
    return res.status(500).json({ error: "Serverfehler", details: error.message });
  }
}
