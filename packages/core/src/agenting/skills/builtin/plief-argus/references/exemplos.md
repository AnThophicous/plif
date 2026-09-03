# Exemplos — pedido, diagnóstico, decisões, entrega

---

## Exemplo 1 — "Faz uma auditoria de segurança na API"

**Escopo assumido (declarado no início da entrega):** repositório `api/` na branch `main` (commit `3f9a2c1`), análise estática e testes locais com fixtures; nenhuma chamada a ambientes remotos; autorização: dono do repositório pediu a revisão.

**Diagnóstico**
- Node 22 + Fastify + Prisma + PostgreSQL; JWT em cookie; multi-tenant por `organizationId`; CI em GitHub Actions; Docker.
- Sem `SECURITY.md`, sem SAST no CI, Dependabot ativo.

**Superfície:** 47 rotas REST, 3 webhooks (Stripe, GitHub, e-mail), upload de avatar, 2 cron jobs, admin interno.

**Achados (resumo)**

| ID | Sev. | Título | Estado |
|---|---|---|---|
| C-01 | Crítica | IDOR em `GET/PUT /invoices/:id`: consulta por `id` sem filtro de `organizationId` | Corrigido |
| A-01 | Alta | Webhook Stripe sem verificação de assinatura em `/webhooks/stripe` | Corrigido |
| A-02 | Alta | Refresh token sem rotação e sem detecção de reuso; `exp` de 30 dias | Corrigido (rotação + reuso invalida família) |
| M-01 | Média | `checkout@v3` e outras actions por tag; `permissions` ausente (padrão write) | Corrigido |
| M-02 | Média | Upload de avatar valida só extensão; SVG aceito e servido inline no mesmo domínio | Corrigido (magic bytes, reprocessamento, SVG rejeitado) |
| M-03 | Média | CORS reflete `Origin` quando presente em lista com `startsWith` (`https://app.exemplo.com.atacante.com` passa) | Corrigido |
| B-01 | Baixa | Ausência de CSP, HSTS e `Permissions-Policy` | Corrigido via `@fastify/helmet` |
| B-02 | Baixa | Rate limit só global, não em `/auth/login` por conta | Corrigido |
| I-01 | Info | 3 alertas Dependabot Altos em devDependencies não alcançáveis em produção | Atualizado mesmo assim; classificado como Info |
| I-02 | Info | `console.log` de payload completo em handler de webhook (PII potencial) | Corrigido |

**Decisões notáveis**
- C-01: em vez de corrigir só as duas rotas, criada extensão do Prisma que injeta `where: { organizationId }` em todos os modelos multi-tenant; testes negativos para 12 rotas. Causa raiz eliminada para a classe inteira.
- A-02: implementada rotação com família de tokens; reuso de refresh antigo invalida a família e loga evento de segurança.
- Hipótese não confirmada registrada: possível condição de corrida em `POST /coupons/redeem` (não reproduzida em teste local; recomendado lock/idempotência).

**Controles verificados como adequados:** hash de senha Argon2id (`auth/password.ts`), validação com Zod `strict` em todas as rotas (`plugins/validation.ts`), consultas via Prisma sem `$queryRaw` com entrada, cookies `HttpOnly; Secure; SameSite=Lax`.

**Ferramentas:** Semgrep 1.9x (ruleset `p/owasp-top-ten`, 0 findings após correções), `npm audit` (0 Altas/Críticas em prod), gitleaks 8.x no histórico completo (0 achados), Trivy no Dockerfile (2 Médias na imagem base → atualizada).

**Não avaliado:** infraestrutura em produção (sem acesso), configuração do WAF, políticas IAM da AWS.

**Verificação:** `lint`, `typecheck`, `vitest` (31 testes novos, todos falhando antes da correção correspondente), `build`.

---

## Exemplo 2 — "Dependabot abriu 14 alertas, resolve isso"

**Escopo assumido:** dependências do `package.json` e `requirements.txt`; branch `develop`.

**Decisões**
1. Triagem por alcançabilidade antes de atualizar às cegas: 9 em devDependencies (Info), 3 transitivas em runtime (2 Médias, 1 Alta: prototype pollution em `lodash` via lib de templates — código alcançável em `render()` com dados de usuário), 2 sem correção disponível.
2. Alta corrigida por atualização do pacote pai; teste adicionado enviando `__proto__` no payload.
3. Sem correção disponível: `overrides` no `package.json` para versão segura de transitiva compatível + registro como risco aceito com prazo de 30 dias e link para a issue upstream.
4. Lockfile regenerado com `npm ci` no CI; adicionado `npm audit --audit-level=high` como check bloqueante.

**Entrega:** tabela de 14 alertas com severidade real, ação e justificativa; 0 alertas Altos/Críticos restantes; 2 Médias como risco aceito documentado.

---

## Exemplo 3 — "Acho que commitamos uma chave da AWS"

**Escopo assumido:** repositório e histórico completo; sem acesso à conta AWS (o usuário tem).

**Decisões**
1. Confirmado via `gitleaks detect --log-opts="--all"`: `AKIA…7Q` em `config/prod.yml`, commit de 41 dias atrás, ainda presente em `main`.
2. Entrega imediata do procedimento de [`resposta-a-segredo-vazado.md`](resposta-a-segredo-vazado.md) adaptado: criar nova chave → atualizar no Secrets Manager e no CI → validar → desativar antiga → revisar CloudTrail dos últimos 41 dias (eventos `CreateUser`, `CreateAccessKey`, `RunInstances`, acesso a S3 fora do padrão) → deletar antiga.
3. No repositório: chave removida, `config/prod.yml` passa a ler `AWS_*` do ambiente, `.env.example` com placeholder, gitleaks como pre-commit e como check no CI com push protection ativada no GitHub.
4. Reescrita do histórico proposta para depois da rotação, com instruções para o time reclonar; explicitado que commits órfãos podem continuar acessíveis pelo hash e que isso não substitui a rotação.

**Não executado pela skill:** rotação na AWS e análise do CloudTrail (sem acesso; executado pelo usuário com o checklist fornecido). Sem uso da chave para "testar".

**Registro:** achado C-01 com janela de exposição, ações, risco residual ("uso indevido no período não pôde ser descartado até a revisão do CloudTrail").
