# Motor de caminhos de ataque — semântica de travessia

Ferramenta: [`../scripts/argus_attackpath.py`](../scripts/argus_attackpath.py) `<security-ir.json> [--from nível-de-capacidade]`

## Forma do caminho

```text
ENTRYPOINT -> [crosses TrustBoundary / accesses Component] ... -> ASSET/SINK
```

Em cada salto, registre: pré-condições, identidade percorrida, privilégio necessário, controles encontrados (arestas `protected_by`) e as marcas de proveniência e completude.

## Classificação

A epistemologia é mecânica, não retórica: o estado sai da condição verificável do caminho, não da impressão de quem audita.

| condição mecânica sobre um caminho completo | estado |
|---|---|
| algum salto sem `provenance.ref` | Possible Risk |
| todos os saltos com evidência **e** todo salto guardado por controle não verificado (`inactive`), sem nenhum salto desguarnecido | Likely Attack Path |
| todos os saltos com evidência **e** pelo menos um salto sem controle algum, ou com controle verificado convivendo com salto desguarnecido | Confirmed Attack Path |
| existe elo fraco, mas ele não fecha cadeia até um ativo | Theoretical Risk |

Duas consequências que surpreendem quem modela pela primeira vez, ambas verificadas contra o motor:

- **Um salto sem controle algum basta para o caminho ser `Confirmed`**, mesmo que todos os outros saltos tenham controle verificado. Faz sentido: se a cadeia atravessa um ponto desguarnecido, os controles vizinhos não a interrompem.
- **`confidence` não participa da classificação.** O motor lê `provenance.ref` e `verified`. O campo `confidence` registra o estado epistêmico para quem lê o relatório, e não rebaixa o estado do caminho — se você quer que um controle não avaliado enfraqueça a classificação, ele precisa existir como nó com `verified: false`.

## Onde prender o controle

A aresta `protected_by` precisa apontar para o **salto** que o controle guarda, não para o ativo no fim da cadeia. O motor avalia os guardas de todos os nós menos o último; um controle preso ao `Asset` terminal fica fora da classificação e o salto aparece como `missing`.

Na prática: o controle de propriedade que impede a leitura de fatura alheia é modelado sobre a fronteira de tenant ou sobre o componente que consulta, não sobre a tabela.

Só os dois primeiros normalmente viram achado acionável. `Theoretical Risk` entra em lista de observação — registrar como achado infla o relatório e desvia a atenção do que é alcançável.

Os rótulos em inglês são os literais emitidos pelo script; mantenha-os no artefato.

## Alavancagem

Para cada controle `C`, `leverage(C)` é o número de caminhos cujo conjunto de saltos inclui o alvo protegido por `C`.

A maior alavancagem indica a remediação que quebra mais caminhos ao mesmo tempo. É assim que a pergunta "qual correção resolve mais?" recebe resposta calculada, e não opinião — e é o que costuma justificar centralizar um controle em vez de remendar cada ocorrência.

## Limites

Nunca gere carga de exploração (payload). O motor produz, no máximo, indicação de prova segura: qual requisição mínima e não destrutiva confirmaria a hipótese em ambiente autorizado.

"Alcançabilidade desconhecida" aparece como `UNKNOWN` com os elos faltantes nomeados um a um. **Lacuna no grafo nunca é lida como segurança.** Não saber se o caminho existe é diferente de saber que ele não existe, e o relatório precisa dizer qual dos dois é o caso.
