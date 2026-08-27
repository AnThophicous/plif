# `plif web` — Terminal no Navegador

Acesse a Plif pelo navegador sem nenhuma mudança na CLI. O comando `plif web`
inicia um adaptador que cria um pseudo-terminal real, spawna a sessão interativa
da Plif dentro dele e transporta a entrada/saída via WebSocket para um emulador
[xterm.js](https://xtermjs.org/) no browser.

## Uso

```bash
plif web                    # http://127.0.0.1:4173
plif web --port 8080        # porta customizada
plif web --host 0.0.0.0    # expor na rede (veja segurança abaixo)
plif web --max-sessions 3   # permitir até 3 abas simultâneas
```

Ao iniciar, o servidor exibe uma URL com token:

```
plif web: open this URL in your browser:
plif web:   http://127.0.0.1:4173/?token=a1b2c3d4...
```

Abra essa URL no navegador. O token é secreto — qualquer pessoa com ele tem
acesso ao terminal.

## Login por senha (`PLIF_WEB_PASSWORD`)

Para um servidor sempre ativo com URL fixa — sem depender do token exibido no
stdout — defina a variável de ambiente `PLIF_WEB_PASSWORD`:

```bash
PLIF_WEB_PASSWORD=minha-senha plif web --host 100.64.0.14
```

Com ela ativa:

- Abrir `http://host:4173/` sem sessão mostra uma página de login com o mesmo
  visual da TUI (toolbar `plif web terminal`, tema escuro, cartão central).
- A senha correta cria o cookie de sessão `plif_session` (`HttpOnly`,
  `SameSite=Lax`), que autentica a página e o upgrade do WebSocket.
- Senha errada reexibe o formulário com "Senha incorreta".
- A URL com token continua funcionando como fallback (scripts/CI).

A senha é comparada em tempo constante (sha256 + `timingSafeEqual`). As sessões
vivem em memória e expiram quando o servidor reinicia.

## Segurança

| Aspecto | Comportamento |
|---|---|
| Bind padrão | `127.0.0.1` (somente local) |
| Token | Gerado aleatoriamente a cada execução; exigido na página e no WebSocket |
| Senha (`PLIF_WEB_PASSWORD`) | Opcional; habilita página de login e cookie de sessão httpOnly |
| Origin | O upgrade WebSocket rejeita Origins de outros domínios |
| Sessões | Limite configurável (`--max-sessions`, default 4); keepalive ping/pong descarta conexões mortas |
| Host não-loopback | Aviso explícito no terminal ao usar `--host` != 127.0.0.1 |

> **Atenção:** mesmo com token, expor na rede (`--host 0.0.0.0`) dá a qualquer
> pessoa com a URL um shell completo. Use apenas em redes confiáveis ou atrás
> de um reverse proxy com TLS.

## Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Ctrl+C` | SIGINT (interrompe o processo) — igual terminal real |
| `Ctrl+Shift+C` | Copiar seleção para o clipboard |
| `Ctrl+Shift+V` | Colar do clipboard |

A toolbar também oferece botões **Copiar**, **Colar** e **Interromper**.

## Arquitetura

```
Browser (xterm.js)
    │  WebSocket JSON (/pty?token=...)
    ▼
@plif/web — server.ts → pty.ts (provider duplo)
    │  prefere node-pty (nativo, opcional)
    │  fallback: bridge Python (stdlib pty)
    ▼
plif CLI (intocada)
```

O provider preferido é o `node-pty` (nativo — o mesmo usado por VS Code e
ttyd): bytes diretos, sem hop extra. Como ele é **dependência opcional**,
máquinas sem toolchain C caem automaticamente no bridge Python
(`bridge/pty-bridge.py`, `pty.openpty`) e `plif web` continua funcionando sem
nada para compilar. O provider ativo aparece no log do servidor:
`plif web: pty provider: node-pty` ou `python-bridge`.

Para compilar o node-pty em host sem toolchain (usa Docker): `npm run build:pty`.

## Requisitos

- Node >= 20.11
- Navegador moderno (xterm.js requer ES2020+)
- PTY: `node-pty` (opcional, nativo) ou `python3` no PATH (bridge fallback;
  `PLIF_PYTHON` sobrescreve o interpretador)

## Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Página 401 | Token ausente ou errado (modo sem senha) | Use a URL completa exibida no terminal |
| Login não aparece | `PLIF_WEB_PASSWORD` não definido | Exporte a variável antes de iniciar o servidor |
| WebSocket 403 | Origin bloqueado | Abra a página diretamente, não via iframe de outro domínio |
| WebSocket 503 | Limite de sessões atingido | Feche abas antigas ou aumente `--max-sessions` |
| "Reconectando" após restart do servidor | Cookie de sessão expirou ou JS antigo em cache | Recarregue a aba (F5) uma vez; o frontend volta para o login sozinho |
| Tela preta | `python3` não encontrado | Verifique `which python3`; ou defina `PLIF_PYTHON=/caminho/python3` |
| Log mostra `pty provider: python-bridge` | `node-pty` sem binário no host | Normal sem toolchain C; para ativar o nativo, `npm run build:pty` |
