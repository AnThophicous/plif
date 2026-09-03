# Ponte entre checklist e SecurityIR

Este é o documento que une as duas metades da skill. Sem ele, o checklist e o grafo seriam dois trabalhos paralelos que nunca se encontram — que é exatamente o problema que a fusão resolve.

## O problema que a ponte resolve

Um checklist responde **"este controle existe?"**. É uma pergunta local, respondida arquivo a arquivo, e produz uma lista plana onde toda ausência parece igualmente grave.

O grafo responde **"este controle está no caminho entre uma entrada alcançável e um ativo?"**. É uma pergunta estrutural, e é a única que separa um controle ausente em código morto de um controle ausente na rota pública que lê a tabela de faturas.

Rodar só o checklist gera relatório inflado. Rodar só o grafo gera cobertura irregular, porque nada lembra o auditor de procurar rotação de refresh token. A ponte é: **cada item do checklist vira um nó `Control` no SecurityIR, com o estado do checklist virando o campo `verified` do nó.**

## Regra de conversão

| Estado no checklist | Nó `Control` no IR | Efeito na travessia (guarda do salto) |
|---|---|---|
| **Presente e adequado** | nó criado com `verified: true` e `provenance` apontando para o código | `active` — o salto deixa de contribuir para o rebaixamento |
| **Ausente ou inadequado** | **nenhum** nó de controle no salto; registre a lacuna como `Threat` | `missing` — basta um salto assim para a cadeia fechar como `Confirmed Attack Path` |
| **Não avaliado** | nó criado com `verified: false`, `confidence: LOW` e o motivo em `provenance` | `inactive` — se **todos** os saltos estiverem assim, a cadeia cai de `Confirmed` para `Likely` |

A terceira linha é a mais importante e a mais fácil de errar. **Não avaliado não é ausente.** Registrar um controle não avaliado como ausente fabrica caminhos confirmados que não existem; registrá-lo como presente esconde risco real. O grafo só se mantém honesto porque esse terceiro estado sobrevive à conversão.

Três detalhes do motor, verificados na prática, que mudam como se modela:

1. **Prenda o `protected_by` ao salto, não ao ativo.** Os guardas do último nó da cadeia não entram na classificação. O controle de propriedade que impede ler a fatura alheia vai sobre a fronteira de tenant ou sobre o componente que consulta — nunca sobre a tabela.
2. **`confidence` não rebaixa caminho.** Quem rebaixa é `verified: false`. O `confidence` existe para o leitor humano e para a cobertura da postura.
3. **Salto sem `provenance.ref` derruba a cadeia inteira para `Possible Risk`**, por mais controles que existam ao redor. É a regra que impede um modelo bem desenhado de parecer conclusivo sem evidência.

## Mapa das áreas

| Área do [`checklist-controles.md`](checklist-controles.md) | Nós e arestas que ela alimenta | Invariante relacionada |
|---|---|---|
| 1. Autenticação | `Identity`, `Principal`, `Control` em `EntryPoint` | ações privilegiadas exigem autenticação |
| 2. Sessão e tokens | `Identity`, `Control`, arestas `delegates_to` | autorização obsoleta; falha fecha |
| 3. Autorização | `Privilege`, `requires`, `protected_by` — ver [`identidade.md`](identidade.md) | isolamento entre tenants; escopo e auditoria |
| 4. Validação e codificação | `Control` sobre `DataFlow` até o sink | entrada validada e codificada no sink |
| 5. Upload | `EntryPoint`, `DataFlow`, `Asset` de armazenamento | entrada limitada; falha fecha |
| 6. CSRF e navegador | `Control` em `EntryPoint` de mutação | ações privilegiadas com escopo |
| 7. Criptografia e segredos | `Asset` de classe segredo, `Control` | segredos ausentes de logs, erros, prompts e artefatos |
| 8. Erros, logs e PII | `DataFlow` para `Service` de log | segredos fora de log; auditoria suficiente |
| 9. Dependências e cadeia de suprimentos | `Dependency`, `provenance` | confiança em dependências e procedência |
| 10. Configuração e infraestrutura | `Service`, `TrustBoundary`, `SystemBoundary` | falha fecha |
| 11. Limite de taxa e abuso | `Control` em `EntryPoint` | disponibilidade |
| 12. Lógica de negócio | `DataFlow`, `Privilege`, invariantes próprias do domínio | conforme o negócio |
| 13. Testes de segurança | eleva o nível da dimensão para `TESTED` em [`postura.md`](postura.md) | — |

O [`checklist-hardening.md`](checklist-hardening.md) alimenta os mesmos nós pelo lado da configuração: headers, cookies, CORS e TLS viram `Control` nas fronteiras; Docker, CI/CD e banco viram `Service` e `TrustBoundary`.

## Onde cada eixo do achado nasce

Um achado desta skill tem três eixos que vêm de lugares diferentes, e é isso que impede o colapso em um número só:

```text
Severidade      <- matriz-de-severidade.md   (impacto x facilidade x pré-requisitos)
Confiança       <- rótulo de evidência        (ciclo-de-achados.md)
Estado do caminho <- travessia do grafo       (caminhos-de-ataque.md)
```

Exemplo concreto da diferença: um alerta crítico de scanner numa dependência que nenhum caminho alcança tem severidade teórica alta, confiança `Possible` e estado `Theoretical Risk` — não vira achado acionável. Uma falha de autorização em rota pública tem severidade crítica, confiança `Confirmed` e `Confirmed Attack Path` — vira o primeiro item do relatório. A lista plana do checklist trataria os dois como "um item marcado".

## Ordem prática

1. Percorra o checklist nas áreas do escopo, registrando os três estados.
2. Converta cada item em nó `Control` conforme a tabela acima.
3. Rode [`../scripts/argus_ir_lint.py`](../scripts/argus_ir_lint.py). Lint vermelho significa modelo incompleto, não erro de formatação.
4. Rode [`../scripts/argus_attackpath.py`](../scripts/argus_attackpath.py) e leia a alavancagem: ela indica qual controle ausente do checklist quebra mais caminhos de uma vez.
5. Só então classifique severidade e escreva os achados.

O passo 4 é o retorno do investimento. Ele responde "por onde começo?" com um número calculado sobre o grafo, em vez da ordem em que os itens apareceram no checklist.
