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
          { property: "Status", direction: "ascending" },
          { timestamp: "created_time", direction: "descending" }
        ]
      })
    });

    if (!notionRes.ok) {
      const text = await notionRes.text();
      return res.status(notionRes.status).json({ error: "Notion API Fehler", details: text });
    }

    const data = await notionRes.json();

    const prop = (props, names) => {
      for (const name of names) if (props[name]) return props[name];
      return undefined;
    };

    const getTitle = p => p?.title?.map(t => t.plain_text).join("") || "";
    const getText = p => p?.rich_text?.map(t => t.plain_text).join("") || "";
    const getSelect = p => p?.select?.name || "";
    const getNumber = p => typeof p?.number === "number" ? p.number : null;
    const getFiles = p => (p?.files || []).map(file => {
      if (file.type === "file") return file.file?.url || "";
      if (file.type === "external") return file.external?.url || "";
      return "";
    }).filter(Boolean);
    const getCover = page => {
      if (!page.cover) return "";
      if (page.cover.type === "file") return page.cover.file?.url || "";
      if (page.cover.type === "external") return page.cover.external?.url || "";
      return "";
    };
    const formatNumber = value => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);

    const items = data.results.map((page, index) => {
      const p = page.properties || {};
      const preis = getNumber(prop(p, ["Preis"]));
      const preisart = getSelect(prop(p, ["Preisart", "Preistyp"]));
      const vermarktungsart = getSelect(prop(p, ["Vermarktungsart", "Vermarktung"]));
      const bilder = [...getFiles(prop(p, ["Bild", "Bilder", "Foto", "Fotos"])), getCover(page)].filter(Boolean);

      let preisText = "";
      const preisartLower = (preisart || "").toLowerCase();
      if (preisartLower.includes("anfrage") || preis === null) {
        preisText = "auf Anfrage";
      } else if (preisartLower.includes("m²") || preisartLower.includes("qm") || preisartLower.includes("pro")) {
        preisText = `${formatNumber(preis)} €/m²${vermarktungsart === "Miete" ? " Miete" : ""}`;
      } else {
        preisText = `${formatNumber(preis)} €${vermarktungsart === "Miete" ? " Miete" : ""}`;
      }

      return {
        id: index + 1,
        notionId: page.id,
        titel: getTitle(prop(p, ["Titel", "Name"])),
        ort: getText(prop(p, ["Ort", "Adresse"])),
        typ: getSelect(prop(p, ["Typ", "Kategorie"])),
        vermarktungsart,
        status: getSelect(prop(p, ["Status"])) || "Verfügbar",
        preis,
        preisart,
        preisText,
        flaeche: getNumber(prop(p, ["Fläche", "Flaeche"])),
        zimmer: getNumber(prop(p, ["Zimmer"])),
        etage: getText(prop(p, ["Etage(n)", "Etagen", "Etage"])),
        lagerflaeche: getNumber(prop(p, ["Lagerfläche", "Lagerflaeche"])),
        teilbarAb: getNumber(prop(p, ["teilbar ab", "Teilbar ab"])),
        beschreibung: getText(prop(p, ["Beschreibung", "Kurzbeschreibung"])),
        bild: bilder[0] || "",
        bilder
      };
    }).filter(item => item.titel);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(items);
  } catch (error) {
    return res.status(500).json({ error: "Serverfehler", details: error.message });
  }
}
