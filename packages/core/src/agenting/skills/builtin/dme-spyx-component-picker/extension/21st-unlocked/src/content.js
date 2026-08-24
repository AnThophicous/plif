// 21st∞ — content script (página principal 21st.dev) — v3
// Caminho primário: iframe do preview (cdn.21st.dev) → username/slug/bundle direto do src
// + nome via .md público same-origin + nome do modal. RSC e fetch hook ficam como fallback.
// Prompt gerado 100% local. Zero requests às APIs limitadas do 21st.

(() => {
  'use strict';

  if (window.__t21stInjected) return;
  window.__t21stInjected = true;

  const HOSTS = (location.host || '').replace(/^www\./, '');
  if (HOSTS !== '21st.dev') return;

  const previewParam = (new URLSearchParams(location.search)).get('preview') || '';
  const IS_COMPONENT_PAGE =
    /\/@[\w-]+\/components\/[\w-]+/.test(location.pathname) ||
    /\/community\/components\/[\w-]+\/[\w-]+/.test(location.pathname) ||
    /\/community\/[\w-]+\/[\w-]+/.test(location.pathname) ||
    /\/@[\w-]+\/components\/[\w-]+/.test(previewParam) ||
    /\/community\/[\w-]+\/[\w-]+/.test(previewParam);

  // parse do previewParam: distingue componente de usuário (@user/components/
  // slug) de componente community (community/categoria/slug-uuid). Retorna
  // { kind, user, slug, slugBase } — slugBase remove o UUID do community.
  function parsePreviewParam() {
    if (!previewParam) return null;
    const mUser = previewParam.match(/\/@([\w-]+)\/components\/([\w-]+)/);
    if (mUser) return { kind: 'user', user: mUser[1], slug: mUser[2], slugBase: mUser[2] };
    const mComm = previewParam.match(/\/community\/([\w-]+)\/([\w-]+)/);
    if (mComm) {
      const slugBase = mComm[2].replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, '');
      return { kind: 'community', category: mComm[1], slug: mComm[2], slugBase };
    }
    return null;
  }

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // ---------- estado compartilhado ----------
  const state = {
    info: {
      name: null,
      description: null,
      demoId: null,
      componentId: null,
      bundleHtmlUrl: null,
      demoCodeUrl: null,
      previewUrl: null,
      username: null,
      slug: null,
      tags: [],
    },
    got: 0,
  };

  function mergeInfo(partial) {
    let changed = false;
    for (const k of Object.keys(partial)) {
      if (partial[k] && !state.info[k]) {
        state.info[k] = partial[k];
        changed = true;
      }
    }
    if (changed) {
      state.got = ['demoId', 'name', 'description', 'bundleHtmlUrl']
        .filter((k) => state.info[k]).length;
      renderInfo();
    }
  }

  // ---------- caminho PRIMÁRIO: iframe do preview ----------
  // Prioridade: (1) iframe que casa com o previewParam (user+slug exato, ou
  // slug do community), dentro do dialog; (2) iframe do dialog; (3) primeiro
  // iframe do CDN. Aceita o user/slug esperados pra não capturar preview de
  // OUTRO componente da home.
  function findPreviewIframe(pm) {
    const all = [...document.querySelectorAll('iframe[src*="cdn.21st.dev"]')];
    if (!all.length) return null;
    const parse = (f) => {
      const m = f.src.match(/cdn\.21st\.dev\/([\w-]+)\/([\w-]+)\/default\/bundle\.([\d.]+)\.html/);
      if (!m) return null;
      return { username: m[1], slug: m[2], bundleHtmlUrl: f.src.split('?')[0] };
    };
    const matches = (p) => {
      if (!p) return true;
      if (p.kind === 'user') return p.user === p.username && p.slug === p.slug;
      return p.slugBase === p.slug || p.slug === p.slug;
    };
    const inDialog = all.filter((f) => f.closest('[role="dialog"]'));
    if (pm) {
      for (const list of [inDialog, all]) {
        for (const f of list) {
          const p = parse(f);
          if (p) {
            if (pm.kind === 'user' && p.username === pm.user && p.slug === pm.slug) return p;
            if (pm.kind === 'community' && p.slug === pm.slugBase) return p;
          }
        }
      }
    }
    for (const f of inDialog) { const p = parse(f); if (p) return p; }
    for (const f of all) { const p = parse(f); if (p) return p; }
    return null;
  }

  // ---------- nome/descrição via .md público (same-origin) ----------
  // Para components community, o .md usa o username/slug oficiais do RSC da
  // página (parseRsc já roda antes e captura username/component_slug).
  // Se o autor não vier do RSC, tenta o primeiro link /@ da página (o autor).
  async function fetchComponentMd(username, slug) {
    if (!slug) return null;
    let user = username;
    if (!user) {
      const a = document.querySelector('a[href^="/@"]');
      if (a) user = (a.getAttribute('href') || '').match(/^\/@([\w-]+)/)?.[1] || null;
    }
    if (!user) return null;
    try {
      const r = await fetch('/@' + user + '/components/' + slug + '.md', { credentials: 'omit' });
      if (!r.ok) return null;
      const txt = await r.text();
      const d = {};
      const mHead = txt.match(/^#\s+(.+)$/m);
      if (mHead) d.name = mHead[1].trim();
      const mDesc = txt.match(/^>\s*(.+)$/m);
      if (mDesc && mDesc[1].trim().length > 10 && mDesc[1].trim() !== d.name) d.description = mDesc[1].trim();
      return Object.keys(d).length ? d : null;
    } catch { return null; }
  }

  // ---------- fallback: RSC payload ----------
  function parseRsc() {
    const out = { username: null, slug: null, demoId: null, componentId: null, bundleHtmlUrl: null, demoCodeUrl: null, previewUrl: null, description: null };

    let json = '';
    const rx = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
    for (const s of document.querySelectorAll('script')) {
      if (!s.textContent || !s.textContent.includes('self.__next_f')) continue;
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(s.textContent))) json += m[1];
    }
    if (!json) return out;

    const mUser = json.match(/\\?"username\\?":\\?"([\w-]+)\\?"/);
    if (mUser) out.username = mUser[1];
    const mSlug = json.match(/\\?"component_slug\\?":\\?"([\w-]+)\\?"/);
    if (mSlug) out.slug = mSlug[1];
    const mDemo = json.match(/\\?"demo\\?":\{\\?"id\\?":(\d+),\\?"component_id\\?":(\d+)/);
    if (mDemo) { out.demoId = +mDemo[1]; out.componentId = +mDemo[2]; }
    const mBundle = json.match(/\\?"bundle_html_url\\?":\\?"(https:\/\/cdn\.21st\.dev[^\\"]+)\\?"/);
    if (mBundle) out.bundleHtmlUrl = mBundle[1];
    const mCode = json.match(/\\?"demo_code\\?":\\?"(https:\/\/cdn\.21st\.dev[^\\"]+)\\?"/);
    if (mCode) out.demoCodeUrl = mCode[1];
    const mPrev = json.match(/\\?"preview_url\\?":\\?"(https:\/\/cdn\.21st\.dev[^\\"]+)\\?"/);
    if (mPrev) out.previewUrl = mPrev[1];
    const mDesc = json.match(/\\?"description\\?":\\?"([^\\"]{60,600})\\?"/);
    if (mDesc) out.description = mDesc[1];
    return out;
  }

  // ---------- fallback: extração de objetos JSON (fetch hook) ----------
  function looksLikeDemoRow(o) {
    return o && typeof o === 'object' && (o.bundle_html_url || (o.id && o.component_id));
  }

  function extractFromJson(obj, depth) {
    if (!obj || depth > 6) return;
    if (looksLikeDemoRow(obj)) {
      const d = {};
      if (obj.id) d.demoId = +obj.id;
      if (obj.component_id) d.componentId = +obj.component_id;
      if (obj.bundle_html_url) d.bundleHtmlUrl = obj.bundle_html_url;
      if (obj.preview_url) d.previewUrl = obj.preview_url;
      if (obj.demo_code) d.demoCodeUrl = obj.demo_code;
      if (obj.name) d.name = obj.name;
      if (obj.description) d.description = obj.description;
      mergeInfo(d);
      return;
    }
    if (obj.component && looksLikeDemoRow(obj.component)) {
      extractFromJson(obj.component, depth + 1);
    }
    if (Array.isArray(obj)) {
      for (const item of obj) extractFromJson(item, depth + 1);
      return;
    }
    if (typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        if (k !== 'props' || depth < 3) extractFromJson(obj[k], depth + 1);
      }
    }
  }

  function installFetchHook() {
    if (window.__t21stFetchHooked) return;
    window.__t21stFetchHooked = true;
    const orig = window.fetch;
    window.fetch = async (...args) => {
      const p = orig.apply(this, args);
      p.then(async (resp) => {
        try {
          const ct = resp.headers.get('content-type') || '';
          if (!ct.includes('json')) return;
          const clone = resp.clone();
          const j = await clone.json();
          extractFromJson(j, 0);
        } catch {}
      }).catch(() => {});
      return p;
    };
  }

  // ---------- fallback: nome/descrição do DOM do modal ----------
  function scrapeModalDom() {
    const d = {};
    // nome: título curto dentro de dialog (ignora textos de auth/UI)
    const skip = /^(Sign in|Log in|Create account|You have opened|Get started|Sign up)/i;
    for (const el of document.querySelectorAll('[role="dialog"] h1, [role="dialog"] h2, [role="dialog"] h3')) {
      const t = (el.textContent || '').trim();
      if (t.length > 1 && t.length < 60 && !skip.test(t)) { d.name = t; break; }
    }
    // descrição: texto longo e não-UI
    const texts = [];
    for (const el of document.querySelectorAll('h1, h2, h3, p')) {
      const t = (el.textContent || '').trim();
      if (t.length > 40 && !texts.includes(t)) texts.push(t);
    }
    for (const t of texts) {
      if (t.length > 80 && t.length < 900 && !/^\s*(Log in|Sign up|Components|Templates|Themes)/.test(t)) {
        d.description = t;
        break;
      }
    }
    if (Object.keys(d).length) mergeInfo(d);
  }

  // ---------- builder do prompt ----------
  function buildPrompt(info, previewHtml) {
    const stack = 'React + TypeScript + Tailwind CSS, shadcn/ui-compatible';
    const lines = [];
    lines.push(`Create a ${stack} component called "${info.name || 'Untitled'}" based on the requirements below.`);
    lines.push('');
    lines.push('## Description');
    lines.push(info.description || 'No description available — match the reference structure exactly.');
    lines.push('');

    if (previewHtml && previewHtml.length > 200) {
      lines.push('## Reference structure (exact rendered HTML with Tailwind classes)');
      lines.push('Reproduce this structure and visual design precisely: layout, spacing, colors, typography, responsive behaviour and animations. Keep the same Tailwind utility classes where possible.');
      lines.push('');
      lines.push('```html');
      lines.push(previewHtml);
      lines.push('```');
      lines.push('');
    } else if (info.previewUrl) {
      lines.push('## Reference preview image');
      lines.push(`Match the visual design shown in this preview: ${info.previewUrl}`);
      lines.push('');
    }

    if (info.tags && info.tags.length) {
      lines.push('## Style tags');
      lines.push(info.tags.join(', '));
      lines.push('');
    }

    lines.push('## Output');
    lines.push('- A single self-contained .tsx file (or a small set of files if genuinely needed), using shadcn/ui primitives and Tailwind utilities.');
    lines.push('- Props with sensible defaults matching the demo usage; responsive (mobile first) and accessible (semantic elements, focus states).');
    lines.push('- No placeholder text beyond what the reference implies; keep the copy from the description.');
    lines.push('- Document the component with a short JSDoc comment.');
    return lines.join('\n');
  }

  // ---------- UI flutuante (sempre no topo) ----------

  // ---------- DME Spyx bridge ----------
  async function getAuthorizedRegistrySnapshot(user, slug) {
    if (!user || !slug) return { available: false, reason: 'identity-missing', files: [] };
    try {
      const r = await fetch(
        '/r/' + encodeURIComponent(user) + '/' + encodeURIComponent(slug),
        { credentials: 'include' }
      );
      if (!r.ok) return { available: false, reason: 'registry-http-' + r.status, files: [] };
      const j = await r.json();
      const files = Array.isArray(j && j.files) ? j.files : [];
      const MAX_SOURCE = 1200 * 1024;
      let total = 0;
      const safe = [];
      for (const f of files) {
        if (!f || typeof f.content !== 'string') continue;
        total += f.content.length;
        if (total > MAX_SOURCE) {
          return {
            available: true,
            omitted: true,
            reason: 'source-payload-too-large',
            name: j && j.name || slug,
            files: [],
          };
        }
        safe.push({
          path: String(f.path || ''),
          content: f.content,
          type: f.type || null,
        });
      }
      return {
        available: safe.length > 0,
        name: j && j.name || slug,
        files: safe,
      };
    } catch (e) {
      return { available: false, reason: 'registry-unavailable', files: [] };
    }
  }

  async function buildSpyxCapsule() {
    const previewHtml = await getPreviewDom();
    const registry = await getAuthorizedRegistrySnapshot(state.info.username, state.info.slug);
    return {
      schema: 'dme-spyx-capsule/v1',
      capturedAt: new Date().toISOString(),
      source: {
        provider: '21st.dev',
        pageUrl: location.href,
        previewParam: previewParam || null,
        capture: '21st-infinity-extension',
      },
      component: {
        name: state.info.name || null,
        description: state.info.description || null,
        username: state.info.username || null,
        slug: state.info.slug || null,
        tags: Array.isArray(state.info.tags) ? state.info.tags : [],
        demoId: state.info.demoId || null,
        componentId: state.info.componentId || null,
      },
      preview: {
        dom: previewHtml || null,
        bundleHtmlUrl: state.info.bundleHtmlUrl || null,
        previewUrl: state.info.previewUrl || null,
      },
      registry,
      handoff: {
        intent: 'candidate',
        doNotAutoInstall: true,
        note: 'Treat preview DOM as evidence; prefer registry source when available.',
      },
    };
  }

  function downloadSpyxCapsule(capsule) {
    const json = JSON.stringify(capsule, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (capsule.component && capsule.component.slug) || 'component';
    a.href = u;
    a.download = slug + '.dme-spyx.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }


  function ensureUI() {
    let host = document.getElementById('t21st-ui');
    if (host) {
      host.remove();
    }
    host = document.createElement('div');
    host.id = 't21st-ui';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;font-family:-apple-system,Segoe UI,Roboto,sans-serif;';

    const btn = document.createElement('button');
    btn.textContent = '🛰 Spyx';
    btn.title = 'DME Spyx: capturar componente localmente';
    btn.style.cssText = 'cursor:pointer;pointer-events:auto;border:1px solid #e2e8f0;background:#0f172a;color:#fff;border-radius:9999px;padding:10px 18px;font-size:14px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;align-items:center;gap:6px;transition:transform .15s ease;';
    btn.addEventListener('mouseenter', () => (btn.style.transform = 'translateY(-2px)'));
    btn.addEventListener('mouseleave', () => (btn.style.transform = 'none'));

    const panel = document.createElement('div');
    panel.style.cssText = 'display:none;pointer-events:auto;position:absolute;right:0;bottom:52px;width:320px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.18);padding:14px;color:#0f172a;font-size:13px;';

    panel.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px;">21st∞ — DME Spyx Bridge</div>
      <div id="t21st-info" style="color:#64748b;margin-bottom:10px;font-size:12px;line-height:1.5;">Procurando componente…</div>
      <button id="t21st-copy-prompt" style="width:100%;cursor:pointer;border:none;background:#0f172a;color:#fff;border-radius:8px;padding:9px 12px;font-size:13px;font-weight:600;margin-bottom:6px;">📋 Copiar prompt (∞)</button>
      <button id="t21st-copy-html" style="width:100%;cursor:pointer;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:6px;">🧩 Copiar HTML do preview</button>
      <button id="t21st-spyx" style="width:100%;cursor:pointer;border:1px solid #0f172a;background:#eef2ff;color:#0f172a;border-radius:8px;padding:9px 12px;font-size:13px;font-weight:650;margin-bottom:6px;">🛰 Enviar para DME Spyx</button>
      <button id="t21st-dl-bundle" style="width:100%;cursor:pointer;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:6px;">⬇️ Baixar bundle (HTML+JS do preview)</button>
      <button id="t21st-extract-shader" style="display:none;width:100%;cursor:pointer;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:6px;">🎨 Extrair shader (GLSL → HTML standalone)</button>
      <button id="t21st-dl-code" style="width:100%;cursor:pointer;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:8px;">⬇️ Código-fonte (registry oficial)</button>
      <div id="t21st-status" style="color:#64748b;font-size:11px;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:8px;">DME Spyx pronto — captura local + handoff autorizado.</div>
    `;

    host.appendChild(btn);
    host.appendChild(panel);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    panel.querySelector('#t21st-copy-prompt').addEventListener('click', async () => {
      if (!state.info.slug && !state.info.demoId && !state.info.description) {
        flash('Componente ainda não identificado — aguarde o preview carregar.');
        return;
      }
      const html = await getPreviewDom();
      const prompt = buildPrompt(state.info, html);
      if (await copyText(prompt)) {
        flash('Prompt (∞) copiado!');
        try {
          chrome.storage.local.get({ t21stLog: [] }, ({ t21stLog }) => {
            t21stLog.unshift({ ts: new Date().toLocaleTimeString(), name: state.info.name || state.info.slug });
            chrome.storage.local.set({ t21stLog: t21stLog.slice(0, 20) });
          });
        } catch {}
      } else flash('Falha ao copiar.');
    });

    panel.querySelector('#t21st-copy-html').addEventListener('click', async () => {
      const html = await getPreviewDom();
      if (!html) { flash('Preview ainda não renderizado — tente de novo em 1s.'); return; }
      if (await copyText(html)) flash('HTML do preview copiado!');
    });

    panel.querySelector('#t21st-spyx').addEventListener('click', async () => {
      const btn = panel.querySelector('#t21st-spyx');
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '🛰 Preparando capsule…';
      try {
        const capsule = await buildSpyxCapsule();
        const resp = await new Promise((resolve) => {
          let done = false;
          chrome.runtime.sendMessage({ type: 'spyx-ingest', capsule }, (r) => {
            if (done) return;
            done = true;
            if (chrome.runtime.lastError) return resolve(null);
            resolve(r || null);
          });
          setTimeout(() => {
            if (!done) {
              done = true;
              resolve(null);
            }
          }, 2500);
        });
        if (resp && resp.ok) {
          flash('🛰 Enviado ao DME Spyx' + (resp.stored ? ' · ' + resp.stored : '') + '.');
          try {
            chrome.storage.local.get({ t21stLog: [] }, ({ t21stLog }) => {
              t21stLog.unshift({
                ts: new Date().toLocaleTimeString(),
                name: '[Spyx] ' + (state.info.name || state.info.slug || 'component'),
              });
              chrome.storage.local.set({ t21stLog: t21stLog.slice(0, 20) });
            });
          } catch {}
        } else {
          downloadSpyxCapsule(capsule);
          flash('Bridge offline — capsule .dme-spyx.json baixado.');
        }
      } catch (e) {
        flash('Spyx falhou: ' + String(e && e.message || e));
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });

    panel.querySelector('#t21st-dl-bundle').addEventListener('click', async () => {
      // HTML completo do bundle via content-frame (same-origin, sem CORS);
      // fallback: fetch direto da bundleHtmlUrl
      let html = null;
      try {
        const resp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'get-bundle-html' }, resolve);
          setTimeout(() => resolve(null), 2500);
        });
        html = resp && resp.html ? resp.html : null;
      } catch {}
      if (!html && state.info.bundleHtmlUrl) {
        try {
          const r = await fetch(state.info.bundleHtmlUrl, { credentials: 'omit' });
          if (r.ok) html = await r.text();
        } catch {}
      }
      if (!html) {
        if (/\/community\//.test(location.pathname) && !state.info.bundleHtmlUrl) {
          flash('Shaders community são protegidos pelo 21st (sem bundle público). Use o botão "Código-fonte (registry)" — com login ele baixa o código real.');
          return;
        }
        flash('Bundle ainda não disponível — o preview precisa renderizar primeiro.');
        return;
      }
      const blob = new Blob([html], { type: 'text/html' });
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = (state.info.slug || 'component') + '-bundle.html';
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
      flash('Bundle baixado.');
    });

    // download do código-fonte real via registry oficial (baixa o .tsx do
    // componente com login). O endpoint /r/user/slug exige sessão (403 sem);
    // com cookie do usuário logado retorna { name, files: [{ path, content }] }.
    async function downloadRegistryCode(user, slug) {
      if (!user || !slug) { flash('Componente ainda não identificado.'); return; }
      let j = null;
      try {
        const r = await fetch(
          '/r/' + encodeURIComponent(user) + '/' + encodeURIComponent(slug),
          { credentials: 'include' }
        );
        if (r.status === 401 || r.status === 403) {
          flash('🔒 O registry exige login no 21st.dev — entre na sua conta (no navegador) e tente de novo.');
          return;
        }
        if (r.status === 404) {
          if (/\/community\//.test(location.pathname)) {
            flash('🔒 Shader community: código protegido pelo 21st — só com plano/unlock no site. Componentes normais baixam pelo registry.');
            return;
          }
          flash('Componente não registrado no registry do 21st.'); return;
        }
        if (!r.ok) { flash('Registry falhou (' + r.status + ').'); return; }
        j = await r.json();
      } catch { flash('Registry indisponível.'); return; }
      const files = (j && j.files) || [];
      if (!files.length) { flash('Registry sem arquivos de código.'); return; }
      let n = 0;
      for (const f of files) {
        if (!f.content) continue;
        const fname = ((f.path || '').split('/').pop() || (j.name || slug) + '.tsx') || 'component.tsx';
        const blob = new Blob([f.content], { type: 'text/plain;charset=utf-8' });
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = fname;
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 5000);
        n++;
      }
      flash(n + ' arquivo(s) de código baixado(s) do registry.');
    }

    // extração do shader community: reconstrói o GLSL dos chunks públicos da
    // página e gera o HTML standalone (mesmo motor validado no pqp) — sem
    // API, sem login. Contorna a proteção do bundle (o bundle é privado, mas
    // o GLSL montado a partir do recipe_json + presets é o render real).
    panel.querySelector('#t21st-extract-shader').addEventListener('click', async () => {
      const btn = panel.querySelector('#t21st-extract-shader');
      btn.disabled = true;
      btn.textContent = '🎨 Extraindo…';
      try {
        const api = window.__t21stShaderExtractApi;
        if (!api) { flash('Extrator não carregado — recarregue a página.'); return; }
        const result = await api.extractShader();
        if (result.error) {
          flash('Extração falhou: ' + result.error + (result.preset ? ' (preset "' + result.preset + '")' : '') + ' — recarregue a página e tente de novo.');
          return;
        }
        const slug = state.info.slug || 'shader';
        const html = api.buildStandaloneHtml({
          name: state.info.name || slug,
          author: state.info.username || '',
          presetLabel: result.presetLabel,
          fragment: result.fragment,
          uniforms: result.uniforms,
        });
        const blob = new Blob([html], { type: 'text/html' });
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = slug + '-standalone.html';
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 5000);
        flash('Shader extraído! Standalone baixado — GLSL ' + (result.fragment.length / 1024).toFixed(1) + ' KB · preset "' + (result.presetLabel || result.presetId) + '".');
      } catch (e) {
        flash('Extração falhou: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🎨 Extrair shader (GLSL → HTML standalone)';
      }
    });

    panel.querySelector('#t21st-dl-code').addEventListener('click', () => {
      downloadRegistryCode(state.info.username, state.info.slug);
    });

    document.body.appendChild(host);
    return host;
  }

  // re-anexa a UI no fim do body quando o modal abre/fecha (garante o topo)
  function keepOnTop() {
    const mo = new MutationObserver(() => {
      const host = document.getElementById('t21st-ui');
      if (host && document.querySelector('[role="dialog"]')) {
        if (document.body.lastElementChild !== host) document.body.appendChild(host);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // garante posição final também no load inicial
    setTimeout(() => {
      const host = document.getElementById('t21st-ui');
      if (host && document.body.lastElementChild !== host) document.body.appendChild(host);
    }, 300);
  }

  let flashTimer = null;
  function flash(msg) {
    const s = document.getElementById('t21st-status');
    if (!s) return;
    s.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      s.textContent = 'DME Spyx pronto — captura local + handoff autorizado.';
    }, 4000);
  }

  function renderInfo() {
    const el = document.getElementById('t21st-info');
    if (!el) return;
    const i = state.info;
    const parts = [];
    if (i.name || i.slug) parts.push('✅ ' + (i.name || i.slug));
    if (i.demoId) parts.push('demo #' + i.demoId);
    if (i.username) parts.push('@' + i.username);
    if (i.description) parts.push('descrição ✓');
    if (i.bundleHtmlUrl) parts.push('bundle ✓');
    el.textContent = parts.length ? parts.join(' · ') : 'Procurando componente… (abra o preview)';
  }

  // ---------- comunicação com o iframe do preview (content-frame) ----------
  function getPreviewDom() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'get-preview-dom' }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.html) return resolve(null);
        resolve(resp.html);
      });
      setTimeout(() => resolve(null), 1500);
    });
  }

  // ---------- init ----------
  async function init() {
    if (!IS_COMPONENT_PAGE && !previewParam) return;
    ensureUI();
    keepOnTop();
    installFetchHook();

    // username/slug do preview param (fallback pra URLs tipo home?preview=...)
    const pm = parsePreviewParam();
    if (pm) {
      mergeInfo({ username: pm.user || null, slug: pm.slugBase || pm.slug });
      if (pm.kind === 'community') mergeInfo({ slug: pm.slugBase });
    }

    // RSC da página (pra community, revela o username/slug oficiais do autor)
    mergeInfo(parseRsc());
    renderInfo();

    // página community direta (sem previewParam): nome do title + autor do DOM
    if (!previewParam && /\/community\/[\w-]+\/[\w-]+/.test(location.pathname)) {
      const slug = location.pathname.split('/').pop().replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, '');
      mergeInfo({ slug });
      const t = document.title.replace(/\s*[—–-]\s*.*$/, '').trim();
      if (t && t.length > 2 && t.length < 80 && !/^(Home|21st)/.test(t)) mergeInfo({ name: t });
      const md = await fetchComponentMd(state.info.username, slug);
      if (md) mergeInfo(md);
      // community shaders são protegidos pelo 21st: o bundle real não é
      // público (nem na página oficial — validado por rede/RSC). sem iframe
      // oculto inútil: a mensagem do painel explica o caminho real.
      const el = document.getElementById('t21st-info');
      if (el && !state.info.bundleHtmlUrl) {
        el.textContent = `🔒 ${state.info.name || slug} — shader community protegido: bundle não é público. Botão "Código-fonte" tenta o registry (exige login).`;
      }
    }

    // detecção de shader community: recipe_json na página expõe o botão de
    // extração GLSL (o fragment é reconstruído dos chunks públicos — o
    // recipe dá o preset id + valores, o resto vem do builder + presets)
    const recipe = window.__t21stShaderExtractApi && window.__t21stShaderExtractApi.extractRecipe();
    if (recipe) {
      state.isShader = true;
      const btn = document.getElementById('t21st-extract-shader');
      if (btn) btn.style.display = 'inline-block';
      const el = document.getElementById('t21st-info');
      if (el && !el.textContent.includes('🔒')) {
        el.textContent = `🎨 ${state.info.name || state.info.slug || 'shader'} — shader community detectado (preset "${recipe.preset}")! Extraia o GLSL → HTML standalone com o botão.`;
      }
    }

    // PRIMÁRIO: varre até o iframe do preview aparecer (home/preview/componente)
    // O .md (nome/descrição) SEMPRE usa o previewParam quando existe — é o
    // componente que o usuário pediu. O iframe só fornece bundle + preview.
    if (pm) {
      const mdUser = pm.user || state.info.username || null;
      const md = await fetchComponentMd(mdUser, pm.slugBase);
      if (md) mergeInfo(md);
    }
    for (let i = 0; i < 20; i++) {
      const f = findPreviewIframe(pm);
      if (f) {
        // só aceita o bundle do iframe se ele corresponde ao pedido (ou se não
        // havia pedido) — evita baixar preview de OUTRO componente
        const ok = !pm ||
          (pm.kind === 'user' && f.username === pm.user && f.slug === pm.slug) ||
          (pm.kind === 'community' && f.slug === pm.slugBase);
        if (ok) {
          mergeInfo(f);
          if (!pm) {
            const md = await fetchComponentMd(f.username, f.slug);
            if (md) mergeInfo(md);
          }
        } else if (pm.kind === 'community') {
          // preview da community é um demo genérico (stand-in) — esperado.
          // o bundle real não é público; o registry (com login) é o caminho.
          const el = document.getElementById('t21st-info');
          if (el) el.textContent = `🔒 ${pm.slugBase} — preview community é demo genérico; o bundle real é protegido. Baixe o código pelo registry (login).`;
        } else {
          // o modal está mostrando outro componente — avisa em vez de capturar errado
          const el = document.getElementById('t21st-info');
          if (el) el.textContent = `⚠️ o modal mostra @${f.username}/${f.slug} — o link pediu ${pm.kind === 'user' ? '@' + pm.user + '/' + pm.slug : pm.slugBase}. Clique no card certo.`;
        }
        break;
      }
      await sleep(500);
    }
    // se o pedido existia mas nenhum iframe casou em 10s
    if (pm && !state.info.bundleHtmlUrl) {
      const el = document.getElementById('t21st-info');
      if (el && !el.textContent.includes('⚠️') && !el.textContent.includes('🔒')) {
        if (pm.kind === 'community') {
          el.textContent = `🔒 ${pm.slugBase} — shader community protegido (bundle não público). Botão "Código-fonte" tenta o registry — logado, baixa o código real.`;
        } else {
          el.textContent = `⏳ ${pm.kind === 'user' ? '@' + pm.user + '/' + pm.slug : pm.slugBase} — aguardando o preview renderizar (se o modal abrir outro componente, clique no card certo).`;
        }
      }
    }

    // fallbacks: fetch hook + DOM do modal
    renderInfo();

    let waited = 0;
    while (waited < 25000) {
      if (state.info.demoId && state.info.description) break;
      scrapeModalDom();
      await sleep(1000);
      waited += 1000;
    }
    renderInfo();

    // pede o DOM do preview pro content-frame
    setTimeout(async () => {
      const html = await getPreviewDom();
      if (html) {
        const el = document.getElementById('t21st-info');
        if (el) el.textContent += `\n🧩 preview renderizado capturado (${(html.length / 1024).toFixed(1)} KB)`;
      }
    }, 2500);

    // status público do plano (informativo)
    try {
      const r = await fetch('https://21st.dev/api/trpc/copyGuard.status?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D', { credentials: 'include' });
      if (r.ok) {
        const j = await r.json();
        const d = j[0]?.result?.data?.json;
        if (d) {
          const el = document.getElementById('t21st-status');
          if (el) el.textContent = `Plano oficial: ${d.signedIn ? 'logado' : 'anônimo'} · ${d.used || 0}/${d.limit || 0} cópias/dia${d.isMember ? ' · membro' : ''} · DME Spyx disponível.`;
        }
      }
    } catch {}

    // re-captura do preview: o iframe pode demorar a montar
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      const html = await getPreviewDom();
      if (html) {
        const el = document.getElementById('t21st-info');
        if (el && !el.textContent.includes('🧩')) {
          el.textContent += `\n🧩 preview renderizado capturado (${(html.length / 1024).toFixed(1)} KB)`;
        }
        break;
      }
    }
  }

  init();
})();