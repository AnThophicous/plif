// 21st∞ — content script nos frames do CDN (iframe do preview do componente)
// Captura o DOM renderizado do componente e envia ao background, que repassa
// ao content script da página principal quando solicitado.

(() => {
  'use strict';

  if (window.__t21stFrame) return;
  window.__t21stFrame = true;

  // ---- página OFICIAL do componente (/@user/components/slug) ----
  // O bundle real da community NÃO é servido na página community (só um demo
  // genérico). Aqui (num iframe oculto da página oficial) capturamos o RSC
  // stream pós-load — que contém bundle_html_url — e avisamos o parent.
  if (/^\/@[\w-]+\/components\/[\w-]+/.test(location.pathname)) {
    const scan = (txt) => {
      if (!txt || txt.length < 300) return;
      const m = txt.match(/\\?"bundle_html_url\\?":\\?"(https:\/\/cdn\.21st\.dev[^\\"]+)\\?"/);
      if (!m) return;
      const mUser = txt.match(/\\?"username\\?":\\?"([\w-]+)\\?"/);
      const mSlug = txt.match(/\\?"component_slug\\?":\\?"([\w-]+)\\?"/);
      try {
        window.parent.postMessage({
          type: '21st-component-data',
          bundleHtmlUrl: m[1],
          username: mUser ? mUser[1] : null,
          componentSlug: mSlug ? mSlug[1] : null,
        }, '*');
      } catch {}
    };
    // 1) fetch hook: o Next busca o RSC stream via fetch — o texto da resposta
    //    contém os self.__next_f.push(...) com o bundle
    try {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const p = origFetch(input, init);
        p.then((res) => {
          try {
            if (!res.ok) return;
            res.clone().text().then(scan).catch(() => {});
          } catch {}
        }).catch(() => {});
        return p;
      };
    } catch {}
    // 2) scan do DOM: o stream também é injetado em <script>self.__next_f
    const scanDom = () => {
      const rx = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
      let json = '';
      for (const s of document.querySelectorAll('script')) {
        if (!s.textContent || !s.textContent.includes('self.__next_f')) continue;
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(s.textContent))) json += m[1];
      }
      if (json) scan(json);
    };
    let scanTries = 0;
    const scanTimer = setInterval(() => {
      scanDom();
      scanTries++;
      if (scanTries > 45) clearInterval(scanTimer); // ~18s
    }, 400);
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'complete') scanDom();
    });
    return;
  }

  const isPreviewFrame = location.pathname.includes('/bundle.') ||
    document.querySelector('#root') !== null;

  if (!isPreviewFrame) return;

  const MAX_HTML = 180 * 1024; // ~180KB do DOM (sem styles/scripts)

  function capture() {
    try {
      const root = document.getElementById('root');
      if (!root) return null;
      const clone = root.cloneNode(true);
      // remove style/script pra o HTML ficar só estrutura + classes tailwind
      clone.querySelectorAll('style, script, link').forEach((n) => n.remove());
      const html = clone.outerHTML;
      if (html.length < 100) return null;
      return html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
    } catch {
      return null;
    }
  }

  let lastSent = null;
  let sent = false;

  function trySend() {
    if (sent) return;
    const html = capture();
    if (!html) return;
    if (html === lastSent) return;
    lastSent = html;
    chrome.runtime.sendMessage({ type: 'preview-dom', html }, () => {
      // se o frame não está conectado, tenta de novo depois
      if (chrome.runtime.lastError) sent = false;
    });
  }

  // tenta capturar depois do load e repetidamente até conseguir
  let tries = 0;
  const timer = setInterval(() => {
    trySend();
    tries++;
    if (tries > 120) clearInterval(timer); // ~4min de margem, para
  }, 400);

  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') trySend();
  });

  // mensagens do background: captura imediata do DOM (prompt) ou do
  // documento COMPLETO do bundle (download .html com scripts inline)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'capture-now') {
      sendResponse({ html: capture() });
    }
    if (msg && msg.type === 'get-bundle-html') {
      // 1) arquivo CRU via fetch same-origin (o original do S3, com scripts
      //    inline — é o que roda o componente de verdade, com animações)
      // 2) fallback: outerHTML do documento montado
      (async () => {
        try {
          const r = await fetch(location.href.split('?')[0], { credentials: 'omit' });
          if (r.ok) {
            const txt = await r.text();
            if (txt.length > 200) { sendResponse({ html: txt }); return; }
          }
        } catch {}
        try {
          const html = document.documentElement.outerHTML;
          sendResponse({ html: html && html.length > 200 ? html : null });
        } catch {
          sendResponse({ html: null });
        }
      })();
      return true; // resposta assíncrona
    }
  });
})();