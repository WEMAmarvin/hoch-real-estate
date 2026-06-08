import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import exposeHtmlHandler from './expose-html-v14.js';

function safeFilename(value) {
  const base = String(value || 'HOCH_Expose')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
  return `${base || 'HOCH_Expose'}.pdf`;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function renderExposeHtml(req) {
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const headers = {};
    const fakeReq = {
      ...req,
      method: 'GET',
      query: { ...(req.query || {}) },
      headers: { ...(req.headers || {}) }
    };
    const fakeRes = {
      setHeader(key, value) { headers[String(key).toLowerCase()] = value; return this; },
      getHeader(key) { return headers[String(key).toLowerCase()]; },
      status(code) { statusCode = code; return this; },
      send(body) { resolve({ statusCode, body: String(body || ''), headers }); },
      json(data) { resolve({ statusCode, body: JSON.stringify(data), headers }); },
      end(body = '') { resolve({ statusCode, body: String(body || ''), headers }); }
    };
    Promise.resolve(exposeHtmlHandler(fakeReq, fakeRes)).catch(reject);
  });
}

export default async function handler(req, res) {
  let browser;
  try {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).send('Immobilien-ID fehlt.');

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'hoch-real-estate.de';
    const origin = `${proto}://${host}`;

    const htmlResult = await renderExposeHtml(req);
    if (htmlResult.statusCode < 200 || htmlResult.statusCode >= 300) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(htmlResult.statusCode).send(htmlResult.body || 'Exposé-HTML konnte nicht erzeugt werden.');
    }

    let html = htmlResult.body;
    if (!/<html/i.test(html)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(500).send('Exposé-HTML ist ungültig.');
    }

    html = html.replace('<head>', `<head><base href="${origin}/">`);
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');

    const titleMatch = html.match(/<div class="cover-object">([\s\S]*?)<\/div>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
    const rawTitle = titleMatch ? decodeHtml(titleMatch[1].replace(/<[^>]*>/g, '').trim()) : '';
    const filename = safeFilename(`HOCH_Expose_${rawTitle || id}`);

    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: ['domcontentloaded', 'networkidle0'], timeout: 60000 });
    await page.emulateMediaType('print');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Length', String(pdfBuffer.length));
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send('PDF-Erstellung fehlgeschlagen: ' + (error?.message || String(error)));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
