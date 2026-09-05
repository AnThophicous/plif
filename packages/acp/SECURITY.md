# SECURITY — Mitigações aplicadas vs o PR original

Auditoria do commit `25d83d4` (feat: add ACP adapter package) e as correções desta versão.

## 🔴 Críticos corrigidos

### 1. `bypassPermissions` sem controle local
- **Original:** o host envia `set_mode: bypassPermissions` (ou `set_config_option`) e o adaptador auto-aprova TODA ação (comandos, escritas, rede) sem o usuário saber.
- **Agora:** `allowBypassPermissions` somente no arquivo `~/.plif/acp-security.json`. Sem opt-in, o request **falha** com mensagem explicativa. Sessões novas sempre nascem em `default`.

### 2. MCP servers do host = execução arbitrária
- **Original:** `toPlifMcpConfigs` aceitava `command + args + env` do host e o `McpRegistry` spawnava — RCE a partir de qualquer host, antes mesmo do primeiro prompt.
- **Agora:** `allowHostMcpServers` (off) + whitelist de primeiro token (`hostMcpCommandPrefixes`). Comando fora da lista → rejeitado com log. `env` do host é filtrado: entradas com `KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL(S)` são removidas antes do spawn.

### 3. Config da plif persistida pelo host
- **Original:** `applyModelChoice` escrevia `~/.plif/config.toml` (modelo/preset) a partir de escolha do host.
- **Agora:** `allowModelSwitch` (off). Quando liberado, a troca é **sessão-local** por default; `persistModelSwitch` (off) é o único caminho para escrita em disco.

## 🟠 Altos corrigidos

### 4. Skills do usuário copiadas para o workspace do host
- **Original:** `materializeUserSkills` copiava `~/.plif/skills` para `<workspace do host>/.plif/skills` — vazamento para diretório de terceiros/sincronizado.
- **Agora:** **removida por completo.** Skills ficam em `~/.plif/skills`; o slash command vira uma instrução e o modelo carrega via tool `skill` dentro do loop. Criptografia não resolveria (o host precisa do conteúdo); não materializar resolve.

### 5. Mask do mount insuficiente
- **Original:** só `.git/config`, `.env`, `.env.local`.
- **Agora:** `MOUNT_MASKS` cobre `.git`, `.env*`, `.npmrc`, `.pypirc`, `.netrc`, `.plif`, `*.pem`, `*.key`, `secrets*`, `credentials*` (com `**` para subdiretórios).

### 6. Sessões ilimitadas
- **Original:** um host podia criar sessões infinitas (memória/recursos).
- **Agora:** `maxSessions` (default 8) com erro claro.

## 🟡 Menores corrigidos

### 7. Teardown ausente
- **Original:** o processo morria sem parar containers/engine.
- **Agora:** `process.stdin.on('end')` → aborta sessões, remove temp dirs, `engine.shutdown()`.

### 8. Logs sem redação
- **Agora:** nenhum log imprime env maps, headers ou valores de credenciais; recusas de segurança são logadas com o motivo.

### 9. Workspace ACP montado como `rw` sem aprovação
- **Original:** a política geral tratava `fs.write` como permitido, embora o ACP montasse o workspace real do host como `rw`.
- **Agora:** a política ACP acrescenta uma regra `ask` para toda escrita/deleção. `default` pede confirmação; `acceptEdits` e `bypassPermissions` só fazem o que seus nomes prometem depois do opt-in correspondente.

### 10. `acceptEdits` escolhido pelo host sem consentimento local
- **Falha encontrada na revisão:** o handler auto-aprovava `fs.write`/`fs.delete` quando a sessão estava em `acceptEdits`, mas o host ainda podia escolher esse modo sem opt-in.
- **Agora:** `allowAcceptEdits` também só vem de `~/.plif/acp-security.json`, começa em `false` e modos não autorizados nem aparecem na lista ACP. Sem isso, toda escrita continua pedindo confirmação.

### 11. Comando que escreve por fora de `fs.write`
- **Falha encontrada na revisão:** como o workspace ACP é um mount `rw`, `node -e`, Python ou um shell podia alterar arquivos diretamente; aprovar só a ferramenta de escrita não cobria esse caminho.
- **Agora:** a política ACP exige `ask` para toda execução. `acceptEdits` continua liberando apenas `fs.write`/`fs.delete`; execução de comandos continua pedindo confirmação, e `bypassPermissions` segue exigindo opt-in local.

## O que foi mantido (comportamento correto do original)

- Fluxo de aprovação no modo `default` (requestPermission ao host com allow_once/allow_always/reject).
- `acceptEdits` auto-aprova apenas `fs.write`/`fs.delete` (pergunta o resto).
- Slash commands de skills via `available_commands_update`.
- Streaming de texto/reasoning/tool calls como notifications.
- `question.asked` solicita uma escolha ao host via `session/request_permission`; cancelar ou falhar responde vazio, nunca escolhe silenciosamente a primeira opção.

## Limitações conhecidas (aceitas por design)

- **Sem autenticação do host**: o protocolo ACP é stdio; quem spawna o adaptador tem controle do canal. A proteção é a política local (capacidades negadas por padrão), não criptografia de canal.
- **`acceptEdits` e `bypassPermissions` ainda entregam poder ao host quando liberados**: são alavancas conscientes; o default é `default` (pergunta por ação).
- O ACP anuncia `loadSession: false`: a sessão já grava transcript canônico local e fecha o container corretamente, mas retomada protocolar de uma sessão antiga ainda precisa ser implementada.
