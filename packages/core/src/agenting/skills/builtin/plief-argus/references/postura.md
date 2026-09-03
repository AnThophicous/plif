# Postura consciente de evidência

Nota de projeto: notas ponderadas de 0 a 100 foram **aposentadas**. Elas produzem precisão falsa — "72/100" sugere medição onde havia arbitragem de pesos, e some com a diferença entre "o controle é fraco" e "eu não olhei essa parte do sistema". O substituto reporta nível e cobertura separadamente.

Cálculo determinístico: [`../scripts/argus_findings.py`](../scripts/argus_findings.py) (subcomando de postura).

## Dimensões

Autenticação · Autorização · Segredos · Dependências · Infraestrutura · Monitoramento · Segurança de IA (ou `N/A`).

Cada uma recebe um nível ordinal:

```text
ABSENT | WEAK | PARTIAL | STRONG | TESTED
```

`TESTED` exige evidência operacional de que o controle foi exercitado no ambiente declarado. Sem essa evidência, o teto é `STRONG`.

## Honestidade de cobertura

Informe a cobertura sobre a superfície aplicável, em porcentagem, e **nomeie** as maiores incógnitas — não basta dizer que 30% não foi avaliado, é preciso dizer o quê.

## Banda geral

```text
cobertura < 70%                          -> SCORE UNAVAILABLE - INSUFFICIENT EVIDENCE
                                            (com as superfícies faltantes listadas)
qualquer dimensão ABSENT                 -> CRITICAL
nível mínimo WEAK                        -> WEAK
nível mínimo PARTIAL                     -> MODERATE
mínimo STRONG e cobertura < 90%          -> MODERATE (limitado por evidência)
todas >= STRONG                          -> STRONG
todas TESTED e cobertura >= 95%          -> STRONG
```

Não existe banda "excelente" sem artefatos do portão de release. A banda é sinal de postura: **não** é probabilidade de comprometimento nem declaração de que o sistema é seguro.

A narrativa que acompanha a banda nomeia o controle mais forte, o mais fraco, a maior incógnita e a única melhoria de maior alavancagem, incluindo o que ela custa.
