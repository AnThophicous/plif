# Anti-padrões — o que faz uma interface parecer genérica ou "feita por IA"

Use como checklist final. Cada item traz o sintoma, por que é ruim e o que fazer no lugar. Se três ou mais itens estiverem presentes sem decisão consciente, a tela não está pronta.

## Cor e superfície

| Sintoma | Problema | Em vez disso |
|---|---|---|
| Gradiente roxo→azul (ou rosa→laranja) em hero, botões e títulos | Marca registrada do template genérico de 2023–2025; não comunica nada sobre o produto | Um acento sólido bem escolhido; gradiente só se for a assinatura da marca e usado uma vez, discretamente |
| "Blobs" desfocados coloridos flutuando no fundo | Ruído visual, custo de render, zero função | Fundo liso ou textura mínima; contraste via `bg`/`bg-subtle` |
| Glassmorphism em tudo (blur + borda branca translúcida) | Legibilidade ruim, contraste imprevisível, caro em mobile | Superfícies sólidas; blur só em overlays (backdrop de modal) |
| Cinza puro (#888, #ccc) | Parece "sem acabamento"; neutros com tinta parecem premium | Escala neutra com 0,5–3 % de saturação |
| Cores aleatórias por card/ícone/gráfico ("arco-íris") | Destrói hierarquia; cor deixa de significar | Neutros + um acento; cor semântica só para significado |
| Fundo sólido saturado em alertas e badges | Gritante, contraste ruim | Superfície tintada (passo 2–3) + texto na cor escura (passo 11) + borda |
| Texto cinza claro sobre branco (#999 em #fff) | Contraste < 4.5:1 | `text-muted` com contraste verificado |
| Sombras pretas fortes (`0 4px 20px rgba(0,0,0,.3)`) | Parece 2012 | Sombras em camadas, suaves, com tinta da cor do texto |
| Tema escuro = paleta clara invertida | Sombras somem, saturações explodem, contraste quebra | Escala escura própria; eleve por luminosidade |

## Tipografia

| Sintoma | Problema | Em vez disso |
|---|---|---|
| Tudo em 16 px e 400 | Sem hierarquia | Escala modular, peso e cor combinados |
| Títulos em 700–900 com `letter-spacing` positivo | Pesado, amador | 600, `letter-spacing` levemente negativo em tamanhos grandes |
| Texto justificado ou centralizado em parágrafos longos | Rios de espaço, leitura difícil | Alinhado à esquerda, medida 45–75 ch |
| Caixa alta em labels de 11 px sem `letter-spacing` | Ilegível | 12–13 px, `letter-spacing` +0,05 em, ou simplesmente caixa normal 500 |
| Mais de 2 famílias + mono | Bagunça | 1 (ou 2 com display) + mono |
| Números proporcionais em tabelas e KPIs | Colunas dançam | `tabular-nums` |
| Line-height 1,5 em títulos de 48 px | Espaço entre linhas gigante | 1,05–1,15 em display |
| Google Fonts com 9 pesos carregados | Peso de página | Só os pesos usados, `font-display: swap`, subset |

## Layout e espaçamento

| Sintoma | Problema | Em vez disso |
|---|---|---|
| Tudo centralizado (título, texto, botões, cards) | Sem ancoragem, leitura em zigue-zague | Alinhamento à esquerda como padrão; centro só em momentos pontuais (hero curto, estado vazio) |
| Grid de 3 colunas com ícone + título + 3 linhas, repetido 2× | O "feature grid" genérico | Narrativa alternada com benefício real, ou grid denso de 1 linha por item |
| Card dentro de card dentro de card | Bordas e sombras acumuladas, hierarquia confusa | Agrupe com espaço e títulos; uma borda por nível no máximo |
| Espaçamento inconsistente (13, 18, 22, 27 px) | Falta de sistema, tela "tremida" | Escala de 4 px |
| Padding igual entre tudo (tudo com 16) | Sem agrupamento perceptível | Menor dentro, maior entre |
| Elementos colados nas bordas em mobile | Parece quebrado | Padding lateral mínimo 16 |
| Conteúdo estirado até 1920 px | Linhas de 200 caracteres | `max-width` de container |
| Alturas fixas em containers de texto | Corta conteúdo real | `min-height` ou nada |
| Layout que só funciona no conteúdo de exemplo | Quebra em produção | Testar com curto, longo, vazio, extremo |

## Componentes

| Sintoma | Problema | Em vez disso |
|---|---|---|
| Emoji como ícone (🚀 ✨ 💡 🎯) | Renderiza diferente por SO, sem controle de cor, parece amador | Conjunto de ícones SVG único |
| Ícone gigante colorido em círculo pastel acima de cada título | Decoração sem função; o "ícone em bolha" | Ícone 20–24 inline, cor `text-muted` ou acento, ou nenhum |
| Botão primário em todo lugar | Nenhuma ação é primária | Um primário por vista; resto secundário/ghost |
| Botão "OK", "Enviar", "Sim" | Não diz o que acontece | Verbo + objeto ("Salvar alterações", "Excluir projeto") |
| Botão pill em tudo + inputs quadrados | Inconsistência de raio | Uma personalidade de raio |
| Placeholder como label | Desaparece ao digitar; a11y ruim | Label visível acima |
| Badges/tags em 6 cores por status | Ninguém memoriza 6 cores | Neutro para a maioria, semântica só para o que precisa atenção |
| Avatar com iniciais em cor aleatória saturada | Ruído | Cor derivada do nome numa paleta suave, ou neutro |
| Tooltip em tudo / tooltip em nada | Ruído ou falta de ajuda | Só onde o rótulo não cabe ou o ícone está isolado |
| Skeleton que não tem a forma do conteúdo | CLS ao carregar | Mesma geometria |
| Spinner de página inteira | Tela morta | Skeleton estrutural |

## Movimento

| Sintoma | Problema | Em vez disso |
|---|---|---|
| Animação em loop no hero (float, pulse, gradiente girando) | Distrai, consome bateria | Estático ou uma entrada única |
| Tudo faz "fade-up" ao rolar | Cansativo, atrasa o conteúdo | Sutil, uma vez, só em seções que importam, ou nada |
| Hover com `scale(1.05)` em cards e botões | Layout salta, parece brinquedo | Mudança de cor/borda/sombra; `translateY(-1px)` no máximo |
| Transições de 500 ms+ em UI de trabalho | Lento, irritante | 120–200 ms |
| Ignorar `prefers-reduced-motion` | Acessibilidade | Sempre respeitar |
| `transition: all` | Anima o que não devia, custo | Propriedades explícitas |

## Conteúdo e microcopy

| Sintoma | Problema | Em vez disso |
|---|---|---|
| "Potencialize", "Revolucione", "Eleve", "Desbloqueie", "Supercharge" | Vazio; todo mundo usa | Diga o que o produto faz em linguagem concreta |
| "Lorem ipsum" ou "Texto de exemplo" na entrega | Não testa o layout real | Conteúdo realista, mesmo que placeholder declarado |
| Depoimentos com nomes genéricos e fotos de stock | Ninguém acredita | Reais ou nenhum |
| Título de página igual ao item de menu e nada mais | Perde contexto | Título + descrição curta ou dados de contexto |
| Erro "Algo deu errado" sem ação | Beco sem saída | O que aconteceu + o que fazer + ação |
| Estado vazio "Nenhum item" | Beco sem saída | Explique e ofereça a próxima ação |

## Estrutura e código

| Sintoma | Problema | Em vez disso |
|---|---|---|
| `div` para tudo, `onClick` em `div` | Sem semântica, inacessível | `button`, `a`, `nav`, `main`, `header`, `section` com heading |
| Headings pulando níveis ou vários `h1` | Estrutura quebrada para leitores de tela e SEO | Um `h1`, hierarquia contínua |
| Estilos inline e valores mágicos espalhados | Não manutenível | Tokens e classes/utilitários do sistema |
| Componente com 40 props booleanas | Explosão combinatória | Composição, variantes limitadas |
| Dependência nova para o que CSS resolve (carousel, tooltip, masonry) | Peso e manutenção | CSS moderno / `<dialog>` / Popover API |
| `!important` para vencer o próprio CSS | Sinal de especificidade descontrolada | Ordem de camadas (`@layer`), tokens |
| `z-index: 9999` | Guerra de z-index | Escala nomeada |
| Cor hard-coded no componente | Quebra tema | Token semântico |
| Tema escuro só no `body` | Componentes claros em fundo escuro | Todos os papéis de cor definidos nos dois temas |
