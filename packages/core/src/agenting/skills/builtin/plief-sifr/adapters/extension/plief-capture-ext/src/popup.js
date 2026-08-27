// 21st∞ — popup: status público do plano + histórico local

async function loadStatus() {
  const el = document.getElementById('plan');
  try {
    const r = await fetch('https://21st.dev/api/trpc/copyGuard.status?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D', { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const d = j[0]?.result?.data?.json;
    if (!d) throw new Error('formato inesperado');
    el.innerHTML =
      '<div class="row"><span>Conta</span><b>' + (d.signedIn ? 'logada' : 'anônima') + '</b></div>' +
      '<div class="row"><span>Plano</span><b>' + (d.isMember ? 'member' : 'free') + '</b></div>' +
      '<div class="row"><span>Uso oficial hoje</span><b>' + (d.used || 0) + ' / ' + (d.limit || 0) + '</b></div>' +
      '<div class="hint" style="margin-top:6px;">Pli'ef Capture usa captura local para descoberta/preview; aquisição continua sendo uma decisão explícita.</div>';
  } catch (e) {
    el.textContent = 'indisponível offline (' + e.message + ')';
  }
}

function loadLog() {
  chrome.storage.local.get({ t21stLog: [] }, ({ t21stLog }) => {
    const el = document.getElementById('log');
    if (!t21stLog.length) return;
    el.innerHTML = t21stLog.map((x) => '<div>' + x.ts + ' — ' + x.name + '</div>').join('');
  });
}

loadStatus();
loadLog();