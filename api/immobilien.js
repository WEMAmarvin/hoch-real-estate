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

    const getTitle = (p) => p?.title?.[0]?.plain_text || "";
    const getText = (p) => p?.rich_text?.map(t => t.plain_text).join("") || "";
    const getSelect = (p) => p?.select?.name || "";
    const getNumber = (p) => typeof p?.number === "number" ? p.number : null;
    const getFiles = (p) => {
      const files = p?.files || [];
      return files.map(file => {
        if (file.type === "file") return file.file?.url || "";
        if (file.type === "external") return file.external?.url || "";
        return "";
      }).filter(Boolean);
    };

    const formatNumber = (value) => {
      if (value === null || value === undefined || value === "") return "";
      return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
    };

    const items = data.results.map((page, index) => {
      const p = page.properties || {};

      const preis = getNumber(p["Preis"]);
      const preisart = getSelect(p["Preisart"]);
      const vermarktungsart = getSelect(p["Vermarktungsart"]);
      const bilder = getFiles(p["Bild"]);

      let preisText = "";
      if (preisart === "auf Anfrage" || preis === null) {
        preisText = "auf Anfrage";
      } else if (preisart === "Preis pro m²") {
        preisText = `${formatNumber(preis)} €/m²${vermarktungsart === "Miete" ? " Miete" : ""}`;
      } else {
        preisText = `${formatNumber(preis)} €${vermarktungsart === "Miete" ? " Miete" : ""}`;
      }

      return {
        id: index + 1,
        notionId: page.id,
        titel: getTitle(p["Titel"]),
        ort: getText(p["Ort"]),
        typ: getSelect(p["Typ"]),
        vermarktungsart,
        status: getSelect(p["Status"]) || "Verfügbar",
        preis,
        preisart,
        preisText,
        flaeche: getNumber(p["Fläche"]),
        zimmer: getNumber(p["Zimmer"]),
        etage: getText(p["Etage(n)"]),
        lagerflaeche: getNumber(p["Lagerfläche"]),
        teilbarAb: getNumber(p["teilbar ab"]),
        beschreibung: getText(p["Beschreibung"]),
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
