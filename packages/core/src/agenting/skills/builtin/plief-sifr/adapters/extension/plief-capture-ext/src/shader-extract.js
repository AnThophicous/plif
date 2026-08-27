// 21st∞ — shader extractor (community shaders) — v1
// Reconstrói o fragment GLSL completo de qualquer shader community do 21st.dev
// a partir de dados PÚBLICOS da página: recipe_json (no RSC/DOM) + chunks do
// Next.js já carregados no browser (performance API). Sem API, sem login.
//
// Descoberta (validada contra o pqp real):
//   - o chunk "builder" (ex. 86922-*.js) contém os templates `a` (body com
//     uniforms/fbm/palette) e `s` (main com as chamadas shade), declarados
//     como `a=\`...\`` e `s=\`...\``, e a montagem `a + "\n" + shade + "\n" + s`
//   - o chunk "presets" (ex. 74006-*.js) contém a lista de presets como
//     {id:"flow",label:"Flow field",group:"Flow",body:`vec3 shade(...)`}
//   - o recipe_json da página dá o id do preset + todos os valores (0-100)
//   - a função real do site (extraída do chunk) converte recipe → uniforms:
//     scale=.5+zoom/100*2, contrast=.6+contrast/100*.9, saturation=sat/50,
//     grain=grain/100*.35, cursorRadius=.12+r/100*.68, timeScale=.1+speed/100*1.9
//     (ou 0 se animated:false), cores repetem a última até 8, e
//     cursorEffect = {push:0, repel:1, swirl:2, ripple:3, spotlight:4}

(() => {
  'use strict';

  if (window.__t21stShaderExtract) return;
  window.__t21stShaderExtract = true;

  const X = {};

  // ---------- recipe_json da página (RSC/DOM) ----------
  // O recipe vive num script flight data como `\"recipe_json\":{...}` (aspas
  // escapadas). Remove os escapes e balanceia chaves para isolar o objeto.
  X.extractRecipe = function () {
    const html = document.documentElement.outerHTML;
    const i = html.indexOf('\\"recipe_json\\":');
    if (i < 0) return null;
    const sub = html.slice(i).replace(/\\"/g, '"');
    let depth = 0, end = -1;
    for (let k = 0; k < sub.length; k++) {
      if (sub[k] === '{') depth++;
      else if (sub[k] === '}') {
        depth--;
        if (depth === 0) { end = k; break; }
      }
    }
    if (end <= 0) return null;
    try {
      return JSON.parse(sub.slice(sub.indexOf('{'), end + 1));
    } catch {
      return null;
    }
  };

  // ---------- chunks já carregados (performance API) ----------
  X.collectChunks = function () {
    return [...new Set(performance.getEntriesByType('resource')
      .map((r) => r.name)
      .filter((n) => n.includes('/_next/static/chunks/') && n.endsWith('.js')))];
  };

  // ---------- identificação dos chunks (por marcadores, sem hardcode) ----------
  X.findBuilderChunk = async function (chunks) {
    for (const url of chunks) {
      try {
        const txt = await (await fetch(url)).text();
        const hasBody = txt.includes('precision highp float') && /,a=`[^`]*#ifdef GL_FRAGMENT_PRECISION_HIGH/.test(txt);
        const hasMain = /,s=`[^`]*void main\(\)/.test(txt) && txt.includes('#define u_scale');
        if (hasBody && hasMain) return { url, text: txt };
      } catch {}
    }
    return null;
  };

  X.findPresetsChunk = async function (chunks) {
    for (const url of chunks) {
      try {
        const txt = await (await fetch(url)).text();
        if (/body:`vec3 shade\(/.test(txt) && /,\{id:"[a-z0-9-]+",label:"/.test(txt)) {
          return { url, text: txt };
        }
      } catch {}
    }
    return null;
  };

  // ---------- extração das peças ----------
  X.extractBuilderParts = function (chunkText) {
    const mBody = chunkText.match(/,a=`([^`]+)`/);
    const mMain = chunkText.match(/,s=`([^`]+)`/);
    if (!mBody || !mMain) return null;
    return { body: mBody[1], main: mMain[1] };
  };

  X.extractShadeByPresetId = function (chunkText, presetId) {
    if (!presetId) return null;
    const m = chunkText.match(
      new RegExp('\\{id:"' + presetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '",label:"[^"]+",group:"[^"]+",body:`([^`]+)`')
    );
    return m ? m[1] : null;
  };

  X.extractPresetLabel = function (chunkText, presetId) {
    if (!presetId) return null;
    const m = chunkText.match(
      new RegExp('\\{id:"' + presetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '",label:"([^"]+)"')
    );
    return m ? m[1] : null;
  };

  // ---------- recipe → uniforms (fórmulas reais do site) ----------
  function hexToRgb(hex) {
    let t = String(hex || '').replace(/^#/, '');
    const r = parseInt(t.length === 3 ? t.replace(/./g, '$&$&') : t, 16);
    return Number.isFinite(r)
      ? [(r >> 16 & 255) / 255, (r >> 8 & 255) / 255, (255 & r) / 255]
      : [0.5, 0.5, 0.5];
  }

  const CURSOR_EFFECT = { push: 0, repel: 1, swirl: 2, ripple: 3, spotlight: 4 };

  X.recipeToUniforms = function (recipe) {
    if (!recipe || typeof recipe !== 'object') return null;
    const r = recipe;
    const colors = (r.colors || []).map(hexToRgb);
    while (colors.length < 8) colors.push(colors[colors.length - 1] || [1, 1, 1]);
    const speed = .1 + (r.speed || 0) / 100 * 1.9;
    return {
      colors: colors.slice(0, 8),
      colorCount: Math.min((r.colors || []).length, 8),
      scale: .5 + (r.zoom || 0) / 100 * 2,
      intensity: (r.intensity || 0) / 100,
      paramA: (r.paramA || 0) / 100,
      warp: (r.warp || 0) / 100 * .6,
      detail: .8 + (r.detail || 0) / 100 * 3.2,
      contrast: .6 + (r.contrast || 0) / 100 * .9,
      brightness: ((r.brightness == null ? 50 : r.brightness) - 50) / 100,
      saturation: (r.saturation || 0) / 50,
      hue: (r.hue || 0) / 360 * 6.2831853,
      vignette: (r.vignette || 0) / 100,
      blur: (r.blur || 0) / 100 * .04,
      grain: (r.grain || 0) / 100 * .35,
      seed: r.seed == null ? 1 : r.seed,
      rotate: (r.rotate || 0) / 360 * 6.2831853,
      offset: [(r.offsetX || 0) / 100, (r.offsetY || 0) / 100],
      drift: (r.drift || 0) / 100 * .4,
      cursorEffect: CURSOR_EFFECT[r.cursorEffect] || 0,
      cursorStrength: (r.cursorStrength || 0) / 100,
      cursorRadius: .12 + (r.cursorRadius || 0) / 100 * .68,
      oklab: r.oklab ? 1 : 0,
      timeScale: r.animated ? (r.motionReverse ? -1 : 1) * speed : 0,
    };
  };

  // ---------- pipeline completo ----------
  X.extractShader = async function () {
    const recipe = X.extractRecipe();
    if (!recipe) return { error: 'no-recipe' };

    const chunks = X.collectChunks();
    if (!chunks.length) return { error: 'no-chunks' };

    const builder = await X.findBuilderChunk(chunks);
    if (!builder) return { error: 'no-builder' };

    const parts = X.extractBuilderParts(builder.text);
    if (!parts) return { error: 'no-parts' };

    // o chunk de presets: só precisa ser baixado se o shade não vier do
    // builder (o builder NUNCA tem o shade; sempre vem do preset).
    const presets = await X.findPresetsChunk(chunks);
    if (!presets) return { error: 'no-presets' };

    const shade = X.extractShadeByPresetId(presets.text, recipe.preset);
    if (!shade) return { error: 'no-shade', preset: recipe.preset };

    const label = X.extractPresetLabel(presets.text, recipe.preset);
    const uniforms = X.recipeToUniforms(recipe);
    const fragment = parts.body + '\n' + shade + '\n' + parts.main;

    return {
      recipe,
      uniforms,
      fragment,
      shade,
      presetLabel: label,
      presetId: recipe.preset,
      builderUrl: builder.url,
      presetsUrl: presets.url,
    };
  };

  // ---------- geração do HTML standalone (mesmo motor validado do pqp) ----------
  X.buildStandaloneHtml = function (opts) {
    const name = opts.name || 'shader';
    const author = opts.author || '';
    const presetLabel = opts.presetLabel || '';
    const fragment = opts.fragment;
    const U = opts.uniforms;

    const colorsJson = JSON.stringify(U.colors.map((c) => [c[0], c[1], c[2]]));
    const uJson = JSON.stringify({
      colors: U.colors,
      colorCount: U.colorCount,
      scale: U.scale,
      intensity: U.intensity,
      paramA: U.paramA,
      warp: U.warp,
      detail: U.detail,
      contrast: U.contrast,
      brightness: U.brightness,
      saturation: U.saturation,
      hue: U.hue,
      vignette: U.vignette,
      blur: U.blur,
      grain: U.grain,
      seed: U.seed,
      rotate: U.rotate,
      offset: U.offset,
      drift: U.drift,
      cursorEffect: U.cursorEffect,
      cursorStrength: U.cursorStrength,
      cursorRadius: U.cursorRadius,
      oklab: U.oklab,
      timeScale: U.timeScale,
    });

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const metaLine = [name, 'community shader', author ? 'by @' + author : '', presetLabel ? '(' + presetLabel + ')' : '', '(21st.dev Shader Builder) · preview standalone'].filter(Boolean).join(' — ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(name)} — 21st.dev community shader (standalone preview)</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  canvas{display:block;width:100vw;height:100vh}
  #meta{position:fixed;left:12px;bottom:10px;color:#ffffff99;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none;text-shadow:0 1px 2px #000;z-index:2}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="meta">${esc(metaLine)}</div>
<script>
const VERT = \`attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}\`;
const FRAG = \`${fragment.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`;
const U = ${uJson};
(() => {
  const canvas = document.getElementById('c');
  canvas.width = Math.max(1, Math.floor(window.innerWidth * (window.devicePixelRatio || 1)));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * (window.devicePixelRatio || 1)));
  const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
  if (!gl) { document.body.innerHTML = '<p style="color:#fff;font-family:monospace;padding:20px">WebGL nao disponivel</p>'; return; }
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || 'compile error';
      document.body.innerHTML = '<pre style="color:#f66;font-family:monospace;padding:20px;white-space:pre-wrap">' + log + '</pre>';
      return null;
    }
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { document.body.innerHTML = '<pre style="color:#f66;font-family:monospace;padding:20px">' + (gl.getProgramInfoLog(prog)||'link error') + '</pre>'; return; }
  gl.useProgram(prog);
  let buf = gl.createBuffer();
  let loc = gl.getAttribLocation(prog, 'a_position');
  function rebuildGeometry() {
    gl.useProgram(prog);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    loc = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
  rebuildGeometry();
  const locs = {
    u_colors: gl.getUniformLocation(prog, 'u_colors'),
    u_scene: gl.getUniformLocation(prog, 'u_scene'),
    u_shape: gl.getUniformLocation(prog, 'u_shape'),
    u_surface: gl.getUniformLocation(prog, 'u_surface'),
    u_finish: gl.getUniformLocation(prog, 'u_finish'),
    u_transform: gl.getUniformLocation(prog, 'u_transform'),
    u_space: gl.getUniformLocation(prog, 'u_space'),
    u_cursor: gl.getUniformLocation(prog, 'u_cursor'),
  };
  const start = performance.now();
  let mouse = [0.5, 0.5];
  canvas.addEventListener('pointermove', (ev) => {
    const r = canvas.getBoundingClientRect();
    mouse = [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  });
  const flat = new Float32Array(U.colors.flat());
  function frame(now) {
    const w = Math.floor(window.innerWidth * devicePixelRatio);
    const h = Math.floor(window.innerHeight * devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      rebuildGeometry();
    }
    const t = (now - start) / 1000;
    const mx = mouse[0] * 2 - 1;
    const my = 1 - mouse[1] * 2;
    gl.uniform3fv(locs.u_colors, flat);
    gl.uniform4f(locs.u_scene, w, h, t * U.timeScale, U.colorCount);
    gl.uniform4f(locs.u_shape, U.scale, U.intensity, U.paramA, U.warp);
    gl.uniform4f(locs.u_surface, U.detail, U.contrast, U.brightness, U.saturation);
    gl.uniform4f(locs.u_finish, U.hue, U.vignette, U.blur, U.grain);
    gl.uniform4f(locs.u_transform, U.seed, U.rotate, U.drift, U.oklab);
    gl.uniform4f(locs.u_space, U.offset[0], U.offset[1], mx, my);
    gl.uniform4f(locs.u_cursor, 1, U.cursorEffect, U.cursorStrength, U.cursorRadius);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
  };

  window.__t21stShaderExtractApi = X;
})();