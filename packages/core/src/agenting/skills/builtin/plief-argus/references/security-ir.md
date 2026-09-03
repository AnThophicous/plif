# SecurityIR — contrato do modelo

O SecurityIR é o estado central da skill: um grafo percorrível do sistema, não uma lista de vulnerabilidades. Tudo o mais — caminhos de ataque, SecDiff, postura, portão de release — lê deste grafo.

Arquivo: `.plif/artifacts/<task-id>/security-ir.json`
Schema: [`../assets/security-ir.schema.json`](../assets/security-ir.schema.json)
Validador: [`../scripts/argus_ir_lint.py`](../scripts/argus_ir_lint.py)

> Os identificadores abaixo (tipos de nó, tipos de aresta, níveis de confiança) são **literais verificados pelos scripts**. Traduzir qualquer um deles quebra o linter e os demais motores. A prosa é em português; o vocabulário da máquina permanece em inglês.

## Tipos de nó

```text
SystemBoundary  Asset  Principal  Identity  EntryPoint
Component  Service  TrustBoundary  DataFlow  Privilege  Control
Dependency  Threat  AttackPath(ref)  Finding(ref)  Invariant
Somente IA: SystemInstructions UserContent UntrustedContent Retrieval
            Memory ModelBoundary ToolAuthorization HumanApproval
```

Campos obrigatórios de cada nó: `id`, `type`, `provenance{kind,ref}`, `confidence` (`LOW|MED|HIGH`), `verified` (booleano). Nós `AttackPath` e `Finding` podem referenciar artefatos em vez de repetir o detalhe inline.

`provenance.kind` aceita: `code`, `config`, `runtime`, `web`, `artifact`, `interview`, `scan`. A referência (`ref`) precisa ser localizável — caminho com linha, chave de configuração, identificador do artefato.

## Tipos de aresta

```text
contains crosses accesses protected_by delegates_to trusts
grants requires approval_of mitigates
```

## Regras rígidas (verificadas pelo linter)

1. Toda ponta de aresta precisa existir; identificadores de nó não se repetem.
2. Faltar `provenance`, `confidence` ou `verified` é erro de lint. **Um diagrama sem evidência não é prova** — essa é a razão da regra, e não uma formalidade.
3. `meta.ai_system: true` exige a presença dos sete tipos de nó de IA.
4. **Invariante da autorização fora do modelo:** qualquer aresta `grants` saindo de um `ModelBoundary` para um `Privilege` é erro de lint e candidata a achado. Saída de modelo nunca concede capacidade.
5. O registro de invariantes de segurança acompanha a lista abaixo, sem reduções.

## Registro de invariantes

Marque cada invariante aplicável ao escopo como preservada, violada, parcialmente verificada, não aplicável ou desconhecida — sempre com evidência:

- isolamento entre tenants;
- segredos ausentes de logs, erros, traces, prompts, memória e artefatos;
- ações privilegiadas exigem autenticação, autorização, escopo e trilha de auditoria;
- entrada validada, limitada e codificada no sink correspondente;
- releases sem dados de depuração nem credenciais de teste;
- confiança em dependências e na sua procedência;
- falha fecha (`fail-closed`), não abre;
- auditoria suficiente para reconstruir o que aconteceu;
- IA não converte conteúdo não confiável em instrução ou ação.

## Por que o grafo antes do checklist

Um checklist responde "este controle existe?". O grafo responde "este controle está no caminho entre uma entrada alcançável e um ativo?". A segunda pergunta é a que decide severidade e prioridade — e é a única que permite calcular alavancagem de remediação. Ver [`ponte-checklist-ir.md`](ponte-checklist-ir.md) para como um vira o outro.
