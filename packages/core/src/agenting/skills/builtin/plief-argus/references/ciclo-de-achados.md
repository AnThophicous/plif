# Achados e ciclo de prova de correção

Ferramenta: [`../scripts/argus_findings.py`](../scripts/argus_findings.py)
Schema: [`../assets/finding.schema.json`](../assets/finding.schema.json)
Formato de redação: [`modelo-de-achado.md`](modelo-de-achado.md)

## Três eixos que não se misturam

| Eixo | O que responde | Onde é definido |
|---|---|---|
| **Severidade** | quanto dói se acontecer | [`matriz-de-severidade.md`](matriz-de-severidade.md) |
| **Confiança** | quanta evidência eu tenho | rótulo de evidência (abaixo) |
| **Estado do caminho** | o caminho fecha até um ativo | [`caminhos-de-ataque.md`](caminhos-de-ataque.md) |

Confiança usa rótulos de evidência, **não** probabilidade de exploração: `Confirmed 100%`, `Highly Likely 80%`, `Possible 50%`, `Hypothesis 25%`.

Nunca colapse os três em um número. Uma falha de autorização confirmada e trivial e um alerta crítico de scanner em código inalcançável produzem números parecidos se você multiplicar tudo — e decisões opostas se você mantiver os eixos separados.

## Campos do registro

ID · Título · Categoria · CWE · mapeamento OWASP · Severidade (`critical|high|medium|low|informational`) · Confiança · Estado do caminho de ataque · Explorabilidade · Superfície, componente e arquivos afetados · Cenário de ataque · Impacto no negócio · Evidência · Reprodução segura · Causa raiz · Correção recomendada · Proteção contra regressão · Invariantes afetadas · Risco residual.

Mais o bloco de ensino, que é o que faz a correção durar: **Problema · Por que é perigoso · Causa raiz · Correção · Princípio · Como evitar a recorrência**.

## Ciclo de vida

```text
OPEN -> REMEDIATION_PROPOSED -> PATCHED -> ATTACK_PATH_BROKEN
     -> REGRESSION_PROTECTED -> VERIFIED
```

Regras impostas pelo script:

1. Transições monotônicas, um passo por vez; regressão reabre o achado **com causa registrada**.
2. `VERIFIED` para um achado de classe `Confirmed` ou `Likely` **exige** que o histórico contenha `ATTACK_PATH_BROKEN` e `REGRESSION_PROTECTED`. Commit ou patch sozinho nunca fecha um achado — essa é a regra que impede o relatório de declarar resolvido o que apenas foi editado.
3. Reverifique depois da última edição, validando o controle alterado **e** o caminho de ataque que motivou a mudança.
4. Deduplique por (causa raiz, componente afetado), somando as evidências. Vinte ocorrências da mesma causa são um achado com vinte locais, não vinte achados.
5. Memória de regressão de segurança guarda afirmações de controle estreitas e duráveis, gravadas apenas onde houver autorização. Em modo somente leitura, proponha a entrada; não escreva.
