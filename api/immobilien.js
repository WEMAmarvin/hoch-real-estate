export default async function handler(req, res) {
  try {
    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID || "34fa4c6888f080c8b2f0f54e1dd714a5";

    if (!notionToken) {
      return res.status(500).json({ error: "NOTION_TOKEN fehlt in den Environment Variables." });
    }

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sorts: [
          { timestamp: "created_time", direction: "descending" }
        ]
      })
    });

    if (!notionRes.ok) {
      const text = await notionRes.text();
      return res.status(notionRes.status).json({
        error: "Notion API Fehler",
        details: text
      });
    }

    const data = await notionRes.json();

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
        case "title":
          return (prop.title || []).map(t => t.plain_text || "").join("").trim();
        case "rich_text":
          return (prop.rich_text || []).map(t => t.plain_text || "").join("").trim();
        case "select":
          return prop.select?.name || "";
        case "multi_select":
          return (prop.multi_select || []).map(s => s.name).join(", ");
        case "number":
          return prop.number === null || prop.number === undefined ? "" : String(prop.number);
        case "date":
          return prop.date?.start || "";
        case "url":
          return prop.url || "";
        case "email":
          return prop.email || "";
        case "phone_number":
          return prop.phone_number || "";
        case "checkbox":
          return prop.checkbox ? "true" : "";
        default:
          return "";
      }
    }

    function richTextHtml(prop) {
      if (!prop || prop.type !== "rich_text") return "";

      return (prop.rich_text || []).map(part => {
        let text = escapeHtml(part.plain_text || "");

        const a = part.annotations || {};
        if (a.code) text = `<code>${text}</code>`;
        if (a.bold) text = `<strong>${text}</strong>`;
        if (a.italic) text = `<em>${text}</em>`;
        if (a.underline) text = `<u>${text}</u>`;
        if (a.strikethrough) text = `<s>${text}</s>`;

        if (part.href) {
          const href = escapeHtml(part.href);
          text = `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        }

        return text;
      }).join("").trim();
    }

    function number(prop) {
      if (!prop) return null;
      if (prop.type === "number") return typeof prop.number === "number" ? prop.number : null;
      const raw = plain(prop);
      if (!raw) return null;
      const normalized = raw
        .replace(/\./g, "")
        .replace(",", ".")
        .replace(/[^0-9.-]/g, "");
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    }

    function select(prop) {
      if (!prop) return "";
      if (prop.type === "select") return prop.select?.name || "";
      return plain(prop);
    }

    function files(prop) {
      if (!prop || prop.type !== "files") return [];
      return (prop.files || []).map(file => {
        if (file.type === "file") return file.file?.url || "";
        if (file.type === "external") return file.external?.url || "";
        return "";
      }).filter(Boolean);
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
      const vermarktung = String(vermarktungsart || "");

      if (art.includes("anfrage")) return "auf Anfrage";
      if (preis === null || preis === undefined) return "auf Anfrage";

      if (art.includes("m²") || art.includes("qm") || art.includes("pro")) {
        return `${formatNumber(preis)} €/m²${vermarktung === "Miete" ? " Miete" : ""}`;
      }

      return `${formatNumber(preis)} €${vermarktung === "Miete" ? " Miete" : ""}`;
    }

    const items = (data.results || []).map((page, index) => {
      const p = page.properties || {};

      const titel = plain(findProp(p, ["Titel", "Name"]));
      const ort = plain(findProp(p, ["Ort", "Adresse", "Standort"]));
      const typ = select(findProp(p, ["Typ", "Kategorie"]));
      const vermarktungsart = select(findProp(p, ["Vermarktungsart", "Vermarktung"]));
      const status = select(findProp(p, ["Status"])) || "Verfügbar";
      const preis = number(findProp(p, ["Preis"]));
      const preisart = select(findProp(p, ["Preisart", "Preistyp", "Preis Typ"]));
      const flaeche = number(findProp(p, ["Fläche", "Flaeche"]));
      const zimmer = number(findProp(p, ["Zimmer"]));
      const etage = plain(findProp(p, ["Etage(n)", "Etagen", "Etage"]));
      const lagerflaeche = number(findProp(p, ["Lagerfläche", "Lagerflaeche"]));
      const teilbarAb = number(findProp(p, ["teilbar ab", "Teilbar ab", "Teilbar Ab"]));

      const beschreibungProp = findProp(p, ["Beschreibung", "Kurzbeschreibung"]);
      const beschreibung = plain(beschreibungProp);
      const beschreibungHtml = richTextHtml(beschreibungProp);

      const bilder = [
        ...files(findProp(p, ["Bild", "Bilder", "Foto", "Fotos"])),
        cover(page)
      ].filter(Boolean);

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

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json(items);
  } catch (error) {
    return res.status(500).json({
      error: "Serverfehler",
      details: error.message
    });
  }
}
