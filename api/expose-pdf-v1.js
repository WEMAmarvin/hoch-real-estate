import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

function safeFilename(value) {
  const base = String(value || 'HOCH_Expose')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
  return `${base || 'HOCH_Expose'}.pdf`;
}

export default async function handler(req, res) {
  let browser;
  try {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).send('Immobilien-ID fehlt.');

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = `${proto}://${host}`;

    const htmlUrl = `${origin}/api/expose-html-v14?id=${encodeURIComponent(id)}`;
    const htmlRes = await fetch(htmlUrl, { headers: { 'User-Agent': 'HOCH-Expose-PDF-Renderer' } });
    if (!htmlRes.ok) {
      const msg = await htmlRes.text();
      return res.status(htmlRes.status).send(msg || 'Exposé-HTML konnte nicht geladen werden.');
    }

    let html = await htmlRes.text();
    html = html.replace('<head>', `<head><base href="${origin}/">`);

    const titleMatch = html.match(/<div class="cover-object">([\s\S]*?)<\/div>/i);
    const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : '';
    const filename = safeFilename(`HOCH_Expose_${rawTitle || id}`);

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    await page.emulateMediaType('print');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    return res.status(500).send('PDF-Erstellung fehlgeschlagen: ' + error.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
