# plif-acp — Secure ACP Adapter

Adaptador **Agent Client Protocol** para a plif, versão **host não-confiável**. Mesmas funcionalidades do PR original (sessões, modos de permissão, seletor de modelo, skills como slash commands, MCP stdio/http/sse) com um modelo de confiança endurecido.

`@plif/acp` é um pacote público do workspace e acompanha a versão estável do
CLI, core e sandbox. A versão atual do workspace é `0.4.0`; o binário instalado
é `plif-acp`.

## Modelo de ameaça

O processo host (ex.: AionUi) é tratado como **NÃO confiável por padrão**. Tudo que ele podia se conceder no PR original agora exige um **opt-in local** explícito. Sem opt-in, as capacidades ficam negadas — não por convenção, por código.

## Instalação

```powershell
# usando o pacote publicado
npm install @plif/acp@0.4.0

# a partir de um clone do repositório
npm ci
npm run build
npm pack --workspace @plif/acp --dry-run
```

O `npm run link` da raiz registra a CLI `plif`, não o adaptador ACP. Para
experimentar este binário a partir do checkout, use o link específico do
workspace (`npm link --workspace @plif/acp`) e remova-o depois com
`npm unlink --workspace @plif/acp`.

## Política de segurança (`~/.plif/acp-security.json`)

Ausente = **tudo negado** (padrões seguros). Exemplo de política completa:

```json
{
  "allowAcceptEdits": false,
  "allowBypassPermissions": false,
  "allowHostMcpServers": true,
  "hostMcpCommandPrefixes": ["npx", "node", "bunx", "uvx"],
  "allowModelSwitch": true,
  "persistModelSwitch": false,
  "maxSessions": 8,
  "workspaceRoots": ["C:/Users/me/projects"]
}
```

As permissões ficam somente no arquivo local. `PLIF_ACP_MAX_SESSIONS` é a única
sobrescrita por ambiente e serve apenas para reduzir/capar a concorrência desta
execução; não concede bypass, MCP do host ou troca de modelo.

### O que cada chave controla

| Chave | Default | O que libera |
|---|---|---|
| `allowAcceptEdits` | `false` | `acceptEdits` (auto-aprova escritas/deleções do workspace montado). Sem isso, o host precisa de aprovação por ação. |
| `allowBypassPermissions` | `false` | `bypassPermissions` (auto-approve de TODA ação). Sem isso, `set_mode`/`set_config_option` com esse valor **falha** com erro explicativo. |
| `allowHostMcpServers` | `false` | MCP servers propostos pelo host. Off = todos rejeitados com log. |
| `hostMcpCommandPrefixes` | `npx, node, bunx, uvx, python` | Primeiro token permitido no `command` de um MCP stdio do host. Qualquer outro é rejeitado com log. |
| `allowModelSwitch` | `false` | Troca de modelo pelo host. Off = `set_config_option model` falha. |
| `persistModelSwitch` | `false` | Persiste a troca de modelo em `~/.plif/config.toml`. Off = troca vale só para a sessão. |
| `maxSessions` | `8` | Teto de sessões simultâneas. |
| `workspaceRoots` | `[]` | Diretórios absolutos adicionais que o host ACP pode abrir. O diretório de execução já é permitido. |

## Funcionalidades (iguais ao PR)

- Sessões ACP com workspace, container (mount rw + network + hostWrite) e histórico; no modo `default`, escritas/deleções **e comandos** pedem aprovação porque comandos também podem escrever no workspace
- Modos de permissão: `default` (pergunta), `acceptEdits` (opt-in local; escreve, pergunta o resto), `bypassPermissions` (opt-in local)
- Seletor de modelo (ranked, só providers alcançáveis com a credencial local)
- Skills como slash commands — o modelo carrega a skill via tool `skill` dentro do loop
- MCP stdio/http/sse do host (com opt-in + whitelist de comando)
- Tool calls e streaming de texto/reasoning como notifications ACP
- Cancelamento de turno via `session/cancel`
- Teardown limpo: fechar o stdio do host para containers e engine

## Diferenças de segurança vs o PR original

| Capacidade | PR original | Versão segura |
|---|---|---|
| `acceptEdits` | host podia auto-aprovar escritas | **negado** até opt-in local |
| Execução no workspace | comandos podiam escrever no mount `rw` sem passar por `fs.write` | **pergunta por comando**; `acceptEdits` não libera execução |
| `bypassPermissions` | host ativa quando quiser | **negado** até opt-in no arquivo local |
| MCP servers do host (`command` arbitrário) | spawna qualquer comando | **negado** até opt-in + whitelist de prefixo |
| env de MCP do host | repassado inteiro | chaves `KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL(S)` **removidas** |
| Troca de modelo | persistida no config da plif | **negada** até opt-in; por default **sessão-local** |
| Skills do usuário | **copiadas para o workspace do host** | **nunca copiadas** — ficam em `~/.plif/skills`, carregadas via tool `skill` |
| Mask do mount | `.git/config`, `.env`, `.env.local` | + `.npmrc`, `.pypirc`, `.netrc`, `.plif`, `*.pem`, `*.key`, `secrets*`, `credentials*` |
| Sessões simultâneas | ilimitadas | cap `maxSessions` |
| Teardown | processo morre, containers podem ficar | `stdin` fechado → aborta sessões, remove temp dirs, `engine.shutdown()` |

## Nota sobre "criptografar skills"

Criptografar skills **não** protege contra vazamento: o host precisa do conteúdo para executar (a skill vira instrução pro modelo), então a chave de decriptografia teria que estar disponível para o processo — mesmo nível de exposição. A proteção real é **não materializar** as skills no workspace do host (diretório que pode ser sincronizado, compartilhado ou lido por outros agentes). Esta versão remove a materialização: as skills continuam em `~/.plif/skills` e o modelo as carrega via tool `skill` quando o host invoca o slash command.

## Uso recomendado

1. Mantenha a política no default (tudo negado) para hosts que você não controla.
2. Para o AionUi da sua própria máquina: libere só o que o fluxo precisa (geralmente nada além de `default` + aprovações).
3. `bypassPermissions` só para experimentos em máquina descartável — ele entrega controle total ao host, por definição.
4. Revisar o log (`plif-acp: ...`) no stderr — toda recusa é registrada com o motivo.
