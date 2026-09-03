---
name: plief-argus
description: Engenharia de segurança sobre um modelo percorrível do sistema (SecurityIR) - threat modeling, travessia de caminhos de ataque com cálculo de alavancagem, revisão de segurança de mudanças (SecDiff), ciclo de achados com prova de correção, hardening, cadeia de suprimentos, segurança de IA e agentes, portão de release e postura consciente de evidência. Use quando o usuário pedir auditoria ou revisão de segurança, análise de vulnerabilidade, threat model, correção de CVE ou alerta de scanner (Dependabot, Snyk, Semgrep, CodeQL, Trivy), rotação de segredo vazado, hardening de headers/cookies/CORS/TLS/Docker/CI, revisão de auth/JWT/sessão/OAuth, checklist OWASP/ASVS, segurança de agente de IA ou injeção de prompt, portão de release, compliance (LGPD, SOC 2, PCI) em código, ou mencionar pentest autorizado e bug bounty próprio.
license: MIT
metadata:
  plief-short-description: Segurança ofensiva-defensiva sobre grafo de risco
  plief-version: "3.0.0"
  plief-author: pli'ef
---

# pli'ef argus

## Missão

Reduzir risco real de segurança sobre um **modelo percorrível do sistema**, não sobre uma lista de vulnerabilidades: entender o que é alcançável, provar com evidência reproduzível em ambiente autorizado, corrigir a causa raiz de forma proporcional e demonstrar que o caminho de ataque foi quebrado — sem introduzir risco novo no processo.

A diferença entre esta skill e um checklist: um checklist responde "este controle existe?"; aqui a pergunta é "este controle está entre uma entrada alcançável e um ativo?". A segunda decide prioridade, e só ela permite calcular qual correção quebra mais caminhos de uma vez.

## Limite obrigatório de autorização

Use esta skill somente em código, dados e ambientes que o usuário está autorizado a analisar.

**Nunca presuma autorização** porque o alvo contém URL, IP, domínio, API, repositório, pacote ou aplicativo. Receber um artefato autoriza **análise**, nada além disso. Antes de qualquer teste ativo, exija todos estes campos:

```text
alvo:  ambiente:  autorização:  responsável:  contas de teste:  dados de teste:
técnicas permitidas:  técnicas proibidas:  limite de requisições:
janela de teste:  condição de parada:
```

Faltando qualquer campo material, opere em **modo de análise segura**: revisão de código, análise de dependências, mocks e fixtures, `localhost`, contêineres descartáveis ou staging autorizado.

Esta skill é defensiva. Não execute nem ensine intrusão não autorizada, roubo ou uso de credenciais, força bruta, exfiltração, persistência, evasão de detecção, malware, ransomware, destruição de dados, indisponibilidade deliberada, phishing ou exploração contra alvos reais sem autorização explícita e verificável. Nunca use credenciais encontradas no repositório, nem "só para testar se funcionam". Se um pedido cruzar esse limite, pare a ação perigosa, explique o limite em uma frase e redirecione para análise local e hardening.

Nunca exponha segredos, PII ou logs sensíveis brutos: mascare como `sk_live_ab…9f` ou `<REDACTED_SECRET>`.

Em teste dinâmico autorizado: a menor prova reversível, dados sintéticos, limites conservadores, uma hipótese por requisição, limpeza imediata e condição de parada declarada. **Pare** diante de dado inesperado, impacto, anomalia de autenticação, aumento de erros ou ambiguidade de escopo.

## Modo padrão

`AUDITORIA SOMENTE LEITURA`: sem alterar código, configuração, dependências ou documentação; sem exploração ativa; sem sondagem externa; sem ação destrutiva; sem mexer em release ou deploy.

Remediação exige autorização explícita e separada. Ao remediar: altere apenas o que tem evidência, preserve comportamento não relacionado e valide tanto o produto quanto as invariantes de segurança.

## Quando usar

- Auditoria ou revisão de segurança de repositório, módulo, PR ou configuração.
- Threat modeling de uma feature, de um sistema ou de uma arquitetura antes da implementação.
- Triagem e correção de alertas de scanner (SAST, SCA, segredos, contêiner, IaC).
- Revisão de segurança de uma mudança, comparando antes e depois (SecDiff).
- Hardening de aplicação, contêiner, pipeline ou infraestrutura como código.
- Resposta a segredo vazado em código ou histórico do Git.
- Revisão de autenticação, autorização, sessão, criptografia, logs e tratamento de PII.
- Segurança de sistemas de IA e agentes: injeção de prompt, autorização de ferramenta, envenenamento de contexto e memória, autonomia excessiva.
- Portão de segurança antes de um release.

## Quando não usar

- Testes ofensivos contra sistemas de terceiros ou sem autorização documentada.
- Trabalho de frontend ou UX sem componente de segurança.
- Operação de incidente em produção ao vivo além de análise e recomendação: executar contenção é decisão do time responsável.

## Modos de operação

| Modo | Para quê |
|---|---|
| `auditoria` | avaliação ampla, somente leitura salvo remediação autorizada à parte |
| `revisão` | revisão focada em um módulo, PR ou área |
| `hardening` | plano de endurecimento com evidência, ou aplicação autorizada |
| `arquitetura` | revisão de desenho antes da implementação |
| `red team` | simulação adversarial autorizada, com o contrato de autorização completo |
| `release` | portão que devolve `PASS`, `CONDITIONAL PASS` ou `BLOCKED` |

Sem modo declarado: pedido amplo vira `auditoria`; pedido estreito vira `revisão`.

## Recursos desta skill

| Arquivo | Conteúdo |
|---|---|
| [`references/security-ir.md`](references/security-ir.md) | Contrato do grafo: tipos de nó e aresta, campos obrigatórios, regras de lint, registro de invariantes. |
| [`references/ponte-checklist-ir.md`](references/ponte-checklist-ir.md) | Como cada item de checklist vira nó do grafo, e de onde vem cada eixo do achado. **Leia antes de auditar.** |
| [`references/caminhos-de-ataque.md`](references/caminhos-de-ataque.md) | Travessia, classificação mecânica dos caminhos e cálculo de alavancagem. |
| [`references/identidade.md`](references/identidade.md) | Cadeia de autorização: quem pode fazer o quê, e as oito falhas típicas. |
| [`references/seguranca-de-ia.md`](references/seguranca-de-ia.md) | Modelo de ameaça de sistemas de IA e agentes no grafo. |
| [`references/ciclo-de-achados.md`](references/ciclo-de-achados.md) | Três eixos do achado e o ciclo de prova de correção. |
| [`references/postura.md`](references/postura.md) | Níveis por dimensão, cobertura honesta e banda geral. |
| [`references/portao-de-release.md`](references/portao-de-release.md) | Checklist do portão e critérios de bloqueio. |
| [`references/matriz-por-tipo-de-projeto.md`](references/matriz-por-tipo-de-projeto.md) | Roteamento por tipo de projeto e modos de teste seguro. |
| [`references/checklist-controles.md`](references/checklist-controles.md) | 13 áreas de controle alinhadas a OWASP ASVS e Top 10. |
| [`references/checklist-hardening.md`](references/checklist-hardening.md) | Configurações seguras de headers, cookies, CORS, TLS, Docker, CI/CD, IaC, dependências e segredos. |
| [`references/matriz-de-severidade.md`](references/matriz-de-severidade.md) | Impacto × facilidade × pré-requisitos, mapeamento para CVSS e SLA sugerido. |
| [`references/modelo-de-achado.md`](references/modelo-de-achado.md) | Template obrigatório de achado e de relatório. |
| [`references/resposta-a-segredo-vazado.md`](references/resposta-a-segredo-vazado.md) | Procedimento para segredo em código ou histórico. |
| [`references/exemplos.md`](references/exemplos.md) | Casos típicos: diagnóstico, decisões e entrega. |

Motores executáveis em `scripts/`, sem dependências externas. Cada um roda com `--selftest`:

| Script | Função |
|---|---|
| [`scripts/argus_ir_lint.py`](scripts/argus_ir_lint.py) | Valida o SecurityIR contra as regras rígidas. |
| [`scripts/argus_attackpath.py`](scripts/argus_attackpath.py) | Percorre entradas até ativos, classifica caminhos e calcula alavancagem. |
| [`scripts/argus_sec_diff.py`](scripts/argus_sec_diff.py) | Compara dois grafos e classifica o delta de risco de uma mudança. |
| [`scripts/argus_findings.py`](scripts/argus_findings.py) | Impõe o ciclo de vida dos achados e calcula a banda de postura. |

Schemas e casos de avaliação em `assets/`.

## Leitura e preparação obrigatórias

1. Leia as instruções do repositório-alvo (`README`, `SECURITY.md`, `CONTRIBUTING`, `AGENTS.md`, regras do editor) e descubra como ele instala, roda, testa e publica.
2. Identifique: linguagem e framework, ambiente de execução, fronteiras de confiança, dados sensíveis (PII, financeiro, saúde, credenciais), integrações externas, mecanismo de autenticação e autorização, pipeline de CI/CD, infraestrutura como código e ferramentas de segurança já configuradas.
3. Classifique o tipo de projeto com [`references/matriz-por-tipo-de-projeto.md`](references/matriz-por-tipo-de-projeto.md).
4. Confirme por escrito, no início da entrega, o escopo autorizado e os limites de teste assumidos.
5. Preserve evidência sem copiar segredo algum para saída, logs, testes, fixtures ou histórico.

## Fluxo de trabalho

### 1. Construir o SecurityIR

Antes de auditar, monte o grafo conforme [`references/security-ir.md`](references/security-ir.md): fronteiras, ativos, principais, identidades, entradas, componentes, fluxos, privilégios, controles e dependências. Todo nó carrega `provenance`, `confidence` e `verified`.

Catalogue as entradas externas de verdade — rotas HTTP, GraphQL, WebSocket, CLI, filas, webhooks, uploads, cron — e diferencie código de produção de teste, exemplo e script local.

Se `meta.ai_system: true`, os sete tipos de nó de IA são obrigatórios ([`references/seguranca-de-ia.md`](references/seguranca-de-ia.md)).

Valide com `argus_ir_lint.py`. **Lint vermelho é modelo incompleto, não detalhe de formatação.**

### 2. Modelar ameaças

Descreva atores (anônimo, autenticado, admin, serviço interno, insider), fronteiras de confiança e fluxos. Liste abusos plausíveis por categoria STRIDE, ligando cada ameaça a um componente concreto e a uma condição observável no código ou na configuração.

### 3. Revisar controles e convertê-los em nós

Percorra [`references/checklist-controles.md`](references/checklist-controles.md) nas áreas do escopo, registrando cada controle como **presente e adequado** (com referência ao código), **ausente ou inadequado** ou **não avaliado** (com o motivo).

Converta cada item em nó `Control` seguindo [`references/ponte-checklist-ir.md`](references/ponte-checklist-ir.md). Preserve os três estados: não avaliado **não** é ausente, e confundir os dois fabrica caminhos de ataque que não existem.

### 4. Traçar caminhos de ataque

Rode `argus_attackpath.py`. A classificação em `Confirmed`, `Likely`, `Possible` e `Theoretical` sai da condição mecânica do caminho, não da impressão de quem audita ([`references/caminhos-de-ataque.md`](references/caminhos-de-ataque.md)).

Leia a alavancagem antes de decidir a ordem das correções: ela nomeia o controle que quebra mais caminhos simultaneamente.

Lacuna no grafo aparece como `UNKNOWN` com os elos faltantes nomeados. **Nunca leia lacuna como segurança.**

### 5. Validar com segurança

Ordem de preferência: análise estática → revisão de configuração → testes existentes → reprodução local com fixtures e dados sintéticos → prova de conceito mínima em ambiente isolado.

Cargas pequenas, sem varredura destrutiva, sem degradar serviço, sem atravessar controle de sistema fora do escopo, sem exfiltrar dado real. A prova de conceito é mínima, não destrutiva, sem persistência, e seus artefatos são removidos depois.

### 6. Classificar

Severidade vem de [`references/matriz-de-severidade.md`](references/matriz-de-severidade.md): impacto × facilidade × pré-requisitos. Não é a categoria do scanner nem a quantidade de ocorrências.

Mantenha severidade, confiança e estado do caminho como **três eixos separados** ([`references/ciclo-de-achados.md`](references/ciclo-de-achados.md)). Um alerta "crítico" em código inalcançável pode ser informativo; uma falha de autorização "simples" em rota pública é crítica.

### 7. Corrigir a causa raiz

- Implemente a menor correção que elimina a causa raiz. Se a mesma classe de falha aparece em vários pontos, centralize o controle (middleware, validador, helper) em vez de remendar cada ocorrência — a alavancagem do passo 4 costuma apontar exatamente para isso.
- Preserve compatibilidade necessária e documente mudança de comportamento.
- Um teste que falharia antes e passa depois é a evidência mínima. Para controles críticos (autorização, validação, criptografia), adicione testes negativos.
- Não reduza segurança para um teste passar; não silencie alerta sem justificativa escrita; não adicione exceção ampla (`# nosec`, `eslint-disable`) sem escopo mínimo e comentário.
- Dependências: atualize para a versão corrigida; se impossível, mitigue e registre como risco aceito com prazo.

### 8. Provar a correção

Avance o achado pelo ciclo `OPEN → REMEDIATION_PROPOSED → PATCHED → ATTACK_PATH_BROKEN → REGRESSION_PROTECTED → VERIFIED` com `argus_findings.py`.

Para achado `Confirmed` ou `Likely`, **commit não fecha nada**: é preciso demonstrar o caminho quebrado e a proteção contra regressão.

### 9. Revisar a mudança

Rode `argus_sec_diff.py` entre o grafo antes e depois. O delta classifica: nova entrada, fluxo entre fronteiras sem controle, identidade sem autorização, expansão de privilégio, dependência introduzida, candidato a caminho de segredo, controle enfraquecido e invariante removida — este último é bloqueante.

O motor compara arestas de proteção pelo par (alvo, controle). **Mover um controle de um nó para outro aparece como `weakened_control` bloqueante**, ainda que a mudança tenha melhorado a proteção. Não silencie o alerta: confirme no grafo novo que o controle guarda o salto certo e registre a justificativa no relatório.

### 10. Postura, portão e entrega

Reporte a postura por dimensão com cobertura honesta ([`references/postura.md`](references/postura.md)). Abaixo de 70% de cobertura, o resultado literal é `SCORE UNAVAILABLE - INSUFFICIENT EVIDENCE`.

Em release, aplique [`references/portao-de-release.md`](references/portao-de-release.md). Build verde não é portão aprovado.

## Critérios de pronto

- Escopo, autorização e limites de teste assumidos estão escritos no início da entrega.
- O SecurityIR existe, passa no lint e cobre a superfície declarada; o que ficou fora está nomeado.
- Cada controle do checklist tem um dos três estados, com referência ao código quando presente.
- Cada achado tem componente, condição, evidência reproduzível sem segredo, impacto, severidade justificada, confiança, estado do caminho, correção e validação.
- Hipóteses e falsos positivos estão separados de vulnerabilidades confirmadas; `Theoretical Risk` não virou achado.
- Correções tratam a causa raiz, mantêm a compatibilidade necessária e têm teste correspondente.
- Achados `Confirmed` ou `Likely` fechados têm caminho quebrado **e** proteção contra regressão no histórico.
- As invariantes de segurança foram marcadas como preservadas, violadas, parcialmente verificadas, não aplicáveis ou desconhecidas — com evidência.
- Postura reportada por dimensão, com cobertura e incógnitas nomeadas; sem nota inventada.
- O diff não introduz credencial, backdoor, bypass, exceção ampla de lint ou comportamento destrutivo.
- Nenhum segredo real aparece em saída, teste, fixture, log ou histórico.
- Limitações e riscos residuais estão documentados.

## Verificação e entrega

1. Rode os motores desta skill (`--selftest` quando quiser confirmar que estão íntegros) e as ferramentas de segurança do repositório (SAST, SCA, secret scanning, contêiner, IaC). Depois lint → typecheck → testes → build. Registre ferramenta, versão e resultado. **Não afirme execução de ferramenta que não estava disponível ou que falhou.**
2. Revise o diff completo em busca de segredo, arquivo fora do escopo e artefato de teste esquecido.
3. Entregue nesta ordem: **escopo e autorização assumidos** → **resumo executivo** (3 a 6 linhas: risco geral, achados por severidade, o que foi corrigido) → **postura por dimensão com cobertura** → **lista técnica priorizada** (um bloco por achado no formato do modelo, ordenada por severidade e depois por alavancagem) → **caminhos de ataque com o estado de cada um** → **controles verificados como adequados** → **não avaliado e limitações** → **riscos residuais aceitos, com dono e prazo** → **próximos passos**.

Cada achado carrega o bloco de ensino — problema, por que é perigoso, causa raiz, correção, princípio e como evitar a recorrência —, porque a entrega precisa deixar o time capaz de não repetir a falha.

Declare escopo, evidência e limitações com exatidão. **Nunca afirme que um sistema está seguro**: afirme o que foi verificado, como, e o que permanece desconhecido.
