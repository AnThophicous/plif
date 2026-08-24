// 21st∞ — service worker
// Roteia o DOM capturado do iframe do preview (cdn.21st.dev) para o content
// script da página principal (21st.dev), por aba.
//
// O worker do MV3 pode dormir a qualquer momento, então o cache usa
// chrome.storage.session (sobrevive ao sono do worker, morre com o browser).

const previewCache = new Map(); // tabId -> html (cache rápido em memória)
const bundleFrameIds = new Map(); // tabId -> frameId do iframe do bundle

async function saveForTab(tabId, html, frameId) {
  previewCache.set(tabId, html);
  if (typeof frameId === 'number' && frameId > 0) bundleFrameIds.set(tabId, frameId);
  if (previewCache.size > 100) {
    const first = previewCache.keys().next().value;
    previewCache.delete(first);
    bundleFrameIds.delete(first);
  }
  try {
    const key = 'preview-' + tabId;
    const cur = await chrome.storage.session.get(key);
    if (cur[key] !== html) await chrome.storage.session.set({ [key]: html });
  } catch {}
}

async function getForTab(tabId) {
  if (previewCache.has(tabId)) return previewCache.get(tabId);
  try {
    const key = 'preview-' + tabId;
    const cur = await chrome.storage.session.get(key);
    if (cur[key]) {
      previewCache.set(tabId, cur[key]);
      return cur[key];
    }
  } catch {}
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'preview-dom') {
    // veio do content-frame (iframe do CDN)
    if (sender.tab && typeof sender.tab.id === 'number') {
      saveForTab(sender.tab.id, msg.html, sender.frameId);
    }
    return;
  }

  if (msg.type === 'get-preview-dom') {
    // veio do content script da página principal
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId === null) { sendResponse({ html: null }); return; }
    getForTab(tabId).then((html) => sendResponse({ html }));
    return true; // resposta assíncrona
  }

  if (msg.type === 'get-bundle-html') {
    // pede o HTML completo do iframe do bundle pro content-frame (same-origin,
    // sem CORS) — o frameId foi registrado quando o preview-dom chegou
    const tabId = sender.tab ? sender.tab.id : null;
    const frameId = tabId !== null ? bundleFrameIds.get(tabId) : null;
    if (tabId === null || frameId === undefined || frameId === 0) {
      sendResponse({ html: null });
      return;
    }
    try {
      chrome.tabs.sendMessage(tabId, { type: 'get-bundle-html' }, { frameId }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.html) {
          sendResponse({ html: null });
        } else {
          sendResponse({ html: resp.html });
        }
      });
      return true;
    } catch {
      sendResponse({ html: null });
      return;
    }
  }

  if (msg.type === 'spyx-ingest') {
    const capsule = msg.capsule;
    if (!capsule || capsule.schema !== 'dme-spyx-capsule/v1') {
      sendResponse({ ok: false, error: 'invalid-capsule' });
      return;
    }
    (async () => {
      try {
        const r = await fetch('http://127.0.0.1:17321/dme-spyx/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(capsule),
        });
        if (!r.ok) {
          sendResponse({ ok: false, error: 'bridge-http-' + r.status });
          return;
        }
        const body = await r.json().catch(() => ({}));
        sendResponse({ ok: true, stored: body.stored || null });
      } catch (e) {
        sendResponse({ ok: false, error: 'bridge-offline', detail: String(e && e.message || e) });
      }
    })();
    return true;
  }

});

chrome.tabs.onRemoved.addListener((tabId) => {
  previewCache.delete(tabId);
  bundleFrameIds.delete(tabId);
  try { chrome.storage.session.remove('preview-' + tabId); } catch {}
});