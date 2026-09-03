# Modelo de achado e de relatório

Use este formato para cada achado e para o relatório final. Campos marcados como obrigatórios não podem ficar vazios; se a informação não existe, escreva por que.

## Achado

```markdown
### [SEVERIDADE] ID — Título curto e específico

**Componente:** caminho/arquivo.ext:linha (ou serviço, rota, configuração)
**Categoria:** CWE-xxx · OWASP Top 10 Axx / ASVS Vx.y
**Estado:** Confirmado | Hipótese não confirmada | Corrigido | Mitigado | Risco aceito

**Condição**
O que precisa ser verdadeiro para a falha existir. Uma ou duas frases concretas,
com referência ao código ou à configuração.

**Evidência**
Como reproduzir em ambiente autorizado, com passos mínimos. Trecho de código
relevante (sem segredos; mascare como `sk_live_ab…9f`). Saída observada.
Se não foi reproduzido, diga o que impede e por que ainda é plausível.

**Impacto**
O que um atacante consegue: ler/alterar/apagar quais dados, de quem, com que
alcance (um usuário, um tenant, todos). Efeito para negócio e usuários.

**Pré-requisitos e facilidade**
Acesso necessário (anônimo, autenticado, admin, rede interna), interação da
vítima, conhecimento especial, ferramentas. Facilidade: trivial | baixa | média | alta.

**Severidade:** Crítica | Alta | Média | Baixa | Informativa
Justificativa em uma frase usando impacto × facilidade × pré-requisitos
(ver matriz-de-severidade.md). CVSS v3.1/v4.0 opcional.

**Correção recomendada**
Mudança de causa raiz, o mais específica possível (função, biblioteca, padrão).
Alternativa de mitigação se a correção completa não for viável agora.

**Correção aplicada** (se houver)
O que foi alterado, arquivos, testes adicionados (nome do teste).

**Validação**
Como foi verificado que a correção funciona: teste que falhava e passa,
reprodução repetida sem sucesso, ferramenta rodada (nome + versão + resultado).

**Risco residual**
O que continua exposto depois da correção/mitigação e por quê.
```

### Regras

- **ID**: sequencial por severidade, ex. `C-01`, `A-01`, `M-03`, `B-02`, `I-01`.
- **Título**: diz o problema e onde, não a categoria ("IDOR em `/api/invoices/:id` permite ler faturas de outros tenants", não "Controle de acesso quebrado").
- **Evidência sem segredos**: nunca cole tokens, senhas, chaves, cookies de sessão ou dados pessoais reais. Use fixtures sintéticas.
- **Um achado por causa raiz**: várias ocorrências da mesma falha viram um achado com lista de ocorrências, não N achados.
- **Não infle**: alerta de scanner sem caminho alcançável é Informativo ou falso positivo, e deve ser dito.

## Relatório final

```markdown
# Revisão de segurança — <repositório / módulo> — <data ISO 8601>

## Escopo e autorização
- Alvo: <repositório, branch, commit, módulos>
- Ambiente de teste: <local / staging / nenhum>
- Autorização assumida: <quem autorizou, o que foi permitido>
- Fora do escopo: <o que não foi olhado e por quê>

## Resumo executivo
<3–6 linhas: nível de risco geral, achados por severidade (ex.: 1 Crítica,
2 Altas, 4 Médias), o que foi corrigido nesta entrega, o que exige ação do time.>

## Achados
<blocos no formato acima, ordenados por severidade e depois por facilidade
de correção>

## Controles verificados como adequados
<lista curta: controle → onde está → por que é adequado. Dá crédito ao que
funciona e evita retrabalho na próxima revisão.>

## Não avaliado e limitações
<o que não foi possível verificar, ferramentas indisponíveis, hipóteses
abertas, dependência de acesso ou de informação do time>

## Ferramentas executadas
| Ferramenta | Versão | Comando | Resultado |
|---|---|---|---|

## Próximos passos recomendados
<ordenados por prioridade, com responsável sugerido e prazo sugerido pela
matriz de severidade>
```
