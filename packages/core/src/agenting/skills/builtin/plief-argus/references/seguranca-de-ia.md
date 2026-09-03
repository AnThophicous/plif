# Segurança de IA e de agentes — modelo no grafo

Aplica-se sempre que `meta.ai_system: true`. Os sete tipos de nó de IA passam a ser obrigatórios, e o linter recusa o SecurityIR sem eles.

## Fluxo de conteúdo e de autoridade

```text
SystemInstructions  ←separa-se de→  UserContent

UntrustedContent (páginas web, arquivos, e-mails, resultados de ferramenta,
                  conteúdo de outros tenants)
   --recebido por--> Retrieval --alimenta--> Memory / ModelBoundary

ModelBoundary --invoca--> ToolAuthorization --concede--> ações em sistemas externos

HumanApproval fica entre o modelo e toda ação irreversível ou de alto impacto
```

## Gatilhos de ameaça por padrão de aresta

| Ameaça | Padrão que a dispara |
|---|---|
| injeção de prompt direta ou indireta | `UntrustedContent` alcança `ModelBoundary` sem `HumanApproval` nem controle de mitigação no meio |
| envenenamento de recuperação | aresta `UntrustedContent → Memory` sem `Control` de validação |
| envenenamento de memória entre sessões ou tenants | `Memory` sem arestas de escopo e propriedade |
| confusão entre instrução e dado | `SystemInstructions` e `UntrustedContent` compartilham um mesmo `DataFlow` de ingestão, sem diferenciação |
| delegado confuso via ferramenta | `ToolAuthorization` concede ações derivadas de conteúdo do usuário sem `approval_of` do principal |
| autoridade excessiva ou obsoleta | escopo concedido é mais largo que o do principal que invocou |
| vazamento entre sessões | memória ou contexto compartilhado cruza fronteira de sessão sem `Control` |
| propagação de segredo | ativo de classe segredo flui para prompt, log, memória ou parâmetro de ferramenta |
| resultado de ferramenta tratado como confiável | fluxo de resultado contorna validação e chega a ação privilegiada |
| ação autônoma irreversível | ação de alto impacto sem `HumanApproval` e sem interruptor de parada |

## Invariante permanente

**A autorização existe fora do modelo. Texto nunca concede capacidade.**

O linter sinaliza mecanicamente qualquer `ModelBoundary --grants--> Privilege`. Toda ação material de um agente precisa de proveniência até uma decisão de autorização autenticada — nunca até uma frase de prompt.

Essa é a diferença entre um agente que "foi convencido" e um agente que não tinha como fazer aquilo: a segunda é a única defesa que sobrevive a um atacante criativo.
