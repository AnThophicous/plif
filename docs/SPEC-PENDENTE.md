# Spec do que falta na plif

Estado em 2026-09-05. Tudo abaixo é lacuna real, medida ou verificada no código
desta pasta — não é lista de desejos. A ordem é a ordem em que eu implementaria.

Referências usadas como comparação: `can1357/oh-my-pi` (omp),
`deepseek-ai/deepseek-harness`, `openai/codex`, `anthropics/claude-code`.

---

## 1. Navegador nativo (maior lacuna vs. omp)

**Hoje:** a plif não tem navegador. O `/mcp` recomenda `@playwright/mcp` da lista
curada, o que funciona, mas custa um processo Node extra, ~1,5 s de handshake por
sessão e um schema de ferramentas que entra inteiro no prompt.

**O que falta:** um subsistema `packages/core/src/browser/` falando CDP direto,
exposto como uma única ferramenta `browser` com sub-ações
(`open`, `click`, `type`, `read`, `screenshot`, `eval`, `network`), no mesmo
padrão de sub-ação que a `exec` já usa.

**Por que importa para token:** uma ferramenta com sub-ações descreve-se em
~200 tokens; os 21 tools do Playwright MCP descrevem-se em ~2.400. Economia por
requisição, em toda sessão que carregue navegador.

**Requisitos duros:**
- O navegador roda **dentro do container**, sob o path jail. Nada de Chrome do
  host — senão o modelo lê o perfil real do usuário, com cookies e sessões.
- Saída de `read` e `network` passa pelo `spillLargeOutput`. Uma página é
  facilmente 200 KB de texto.
- `eval` é capability separada, negada por padrão, na mesma escada do `exec`.
- Screenshot vira arquivo no spill, não base64 no contexto.

**Esforço:** grande. É o item mais caro da lista e o de maior retorno.

---

## 2. Depurador (DAP)

**Hoje:** nada. Para depurar, o modelo insere `console.log` e roda de novo — o
laço mais caro em tokens que existe, porque cada tentativa reexecuta o programa
inteiro e relê a saída.

**O que falta:** cliente Debug Adapter Protocol em
`packages/core/src/debug/`, ferramenta `debug` com sub-ações
`launch`, `breakpoint`, `step`, `continue`, `stack`, `inspect`.
Adaptadores iniciais: Node (`node --inspect`) e Python (`debugpy`).

**Por que importa:** substitui o laço print-e-reroda por uma inspeção. Um bug
que hoje come 6 a 10 turnos vira 2 a 3.

**Requisito duro:** o processo depurado é um processo do container e herda a
policy dele. A porta do inspector nunca é publicada no host.

**Esforço:** médio-grande. Depende de nada do item 1; pode ir em paralelo.

---

## 3. LSP: de 4 operações para ~14

**Hoje:** `packages/core/src/lsp/` implementa diagnostics, hover, definition,
references. O omp tem 14.

**O que falta, em ordem de valor por token economizado:**

| Operação | Por que |
|---|---|
| `rename` | Renomear símbolo hoje é grep + N edits. Uma chamada substitui isso. |
| `documentSymbol` | Dá o mapa de um arquivo sem ler o arquivo. Mata muito `read_file`. |
| `workspaceSymbol` | Acha um símbolo no projeto sem `grep` em árvore inteira. |
| `codeAction` | Aplica o quick-fix que o servidor já calculou, de graça. |
| `signatureHelp` | Evita ler a definição só para ver a assinatura. |
| `implementation` / `typeDefinition` | Fecha o buraco de `definition` em código com interfaces. |
| `formatting` | Remove a dependência de prettier/black por `exec`. |
| `callHierarchy` | Rastreia caller/callee sem ler cada arquivo do caminho. |

`documentSymbol` e `workspaceSymbol` são as duas de maior retorno: são as que
tiram `read_file` e `grep` inteiros do laço.

**Nota:** há um teste de diagnostics de TypeScript que falhou uma vez e passou
isolado e na repetição. É flaky, não regressão, mas convém estabilizar antes de
crescer o módulo — mais operações sobre uma base flaky significa mais falsos
alarmes.

**Esforço:** médio, e incremental — cada operação entra sozinha.

---

## 4. Busca na web nativa

**Hoje:** só via MCP.

**O que falta:** ferramenta `web_search` + `web_fetch` nativas, com o extrator de
conteúdo legível rodando **antes** de o texto entrar no contexto. HTML cru de uma
página de resultados é 50 a 100× o tamanho do conteúdo útil.

**Requisito duro:** `web_fetch` é saída de dados para fora. Todo conteúdo trazido
é dado não confiável — nunca instrução — e isso precisa estar dito no prompt da
ferramenta, não só na minha cabeça.

**Esforço:** pequeno-médio.

---

## 5. Estratégia de carregamento de skills

**Hoje:** as skills são compiladas e entregues como prompts. O que eu **não**
fiz, e você pediu: comparar o *gatilho* — quando cada harness decide carregar o
corpo de uma skill.

**O que falta:** auditar os quatro e escolher. As quatro estratégias são
diferentes de verdade:
- Claude Code: índice de uma linha por skill sempre presente, corpo carregado por
  chamada de ferramenta explícita.
- Codex: injeção por match de caminho/arquivo.
- DeepSeek: seleção por modo.
- omp: catálogo com busca.

**Por que importa:** é decisão de token puro. Índice de N skills a uma linha cada
custa ~15 tokens por skill por requisição; corpo carregado à toa custa 500 a
3.000. Com 20 skills instaladas a diferença é a ordem de 10 mil tokens por
requisição.

**Esforço:** pequeno para medir, médio para trocar. **Faria isto primeiro**, é o
melhor retorno por hora de trabalho da lista inteira.

---

## 6. Polimento visual da TUI

**Hoje:** o custo de frame já está resolvido (3.000 células: 91,91 ms → 0,62 ms,
medido). O que resta é aparência, e eu **não** consigo julgar isso sem ver a sua
tela — nunca vou capturar a tela por conta própria.

**O que falta de mim:** você abrir a plif já linkada nesta pasta e mandar o
print. Aí eu aplico, com a skill de design de frontend que está disponível aqui.

**Esforço:** desconhecido até eu ver.

---

## 7. Comandos ainda sem menu

Estado: 35 de 42 comandos têm superfície interativa.

- Sem menu **de propósito**, e devem continuar assim: `/clear`, `/paste`,
  `/compact`. São ações de um passo sem parâmetro; um menu ali é um clique a mais
  para nada.
- Vista única, poderiam virar menu: `/temp`, `/store`.

**Esforço:** pequeno. É acabamento.

---

## 8. Dívida conhecida

- **`plif-workspace@0.4.0` global ainda aponta para `Downloads\plif-main`.** Só
  o `@plif/cli` foi reapontado. O comando `plif` que você usa está correto, mas
  esse link solto é exatamente o tipo de coisa que causou a confusão de hoje.
  Vale remover.
- **Code mode do DeepSeek não é padrão.** Medido: sozinho economiza 4,5% do
  prompt de sistema (19.448 → 18.573 tokens). Com o layer `compact` junto, 57,7%.
  Ou seja: o ganho é do `compact`, não do code mode. Deixei o code mode
  disponível e opt-in por `/prompt-layer` porque promovê-lo a padrão trocaria o
  comportamento do agente por quase nada de economia. Se você quiser padrão
  mesmo assim, é uma linha — mas a medição não sustenta.
- **snapcompact do omp: decidi não portar.** O spill remove o volume na origem
  (transcript de 40 turnos: 50.412 → 8.872 tokens, e os estágios de compactação
  caíram de 4 para 0). Comprimir o que já não existe não rende nada.

---

## Ordem recomendada

1. Estratégia de carregamento de skills (item 5) — melhor retorno por hora.
2. LSP `documentSymbol` + `workspaceSymbol` (item 3) — tira leitura do laço.
3. Depurador (item 2) — encurta o laço de bug.
4. Busca na web nativa (item 4).
5. Navegador nativo (item 1) — o maior, deixado para quando o resto estiver firme.
6. Acabamento: menus restantes, dívida de link, visual quando você mandar o print.

Itens 2 e 3 são independentes e podem ir em paralelo.
