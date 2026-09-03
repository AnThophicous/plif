# Sistema de design — escalas e valores de referência

Valores que produzem interfaces profissionais na maioria dos produtos. Use-os para criar tokens quando o projeto não tem sistema, ou para auditar um sistema existente. Adapte com critério; não copie cegamente se o produto já tem identidade definida. Implementação pronta em [`../assets/tokens.css`](../assets/tokens.css).

## 1. Tipografia

### Famílias

- **Texto/UI:** uma sans-serif com boa legibilidade em tamanhos pequenos e números tabulares (Inter, Geist, IBM Plex Sans, Source Sans 3, Public Sans, system-ui como fallback).
- **Display (opcional):** só se a marca pedir. Uma serif ou grotesk com personalidade para títulos grandes. É uma das formas mais eficazes de dar "assinatura".
- **Mono:** para código, IDs, valores técnicos (JetBrains Mono, Geist Mono, IBM Plex Mono, ui-monospace).
- Nunca mais de 2 famílias + mono. Carregue apenas os pesos usados (normalmente 400, 500, 600; às vezes 700).

### Escala modular (razão 1,25 — "major third")

| Token | rem | px (16 base) | Uso |
|---|---|---|---|
| `xs` | 0.75 | 12 | legendas, metadados, badges |
| `sm` | 0.875 | 14 | texto secundário, tabelas densas, labels |
| `base` | 1 | 16 | corpo |
| `lg` | 1.125 | 18 | lead, corpo em landing |
| `xl` | 1.25 | 20 | h4, títulos de card |
| `2xl` | 1.5 | 24 | h3 |
| `3xl` | 1.875 | 30 | h2 |
| `4xl` | 2.25 | 36 | h1 de app |
| `5xl` | 3 | 48 | h1 de landing |
| `6xl` | 3.75 | 60 | hero |
| `7xl` | 4.5 | 72 | hero grande |

Para landing pages use tamanhos fluidos: `clamp(2.25rem, 1.5rem + 3vw, 4.5rem)`.

### Line-height

- Texto corrido: 1,5–1,6.
- UI (botões, labels, tabelas): 1,25–1,4.
- Títulos: 1,1–1,2 (quanto maior o tamanho, menor o line-height).
- Display: 1,0–1,05.

### Letter-spacing

- Corpo: 0.
- Títulos ≥ 30 px: −0,01 em a −0,025 em.
- Display ≥ 48 px: −0,02 em a −0,04 em.
- Caixa alta pequena (labels, overlines): +0,05 em a +0,1 em.

### Peso

- Corpo 400; ênfase e labels 500; títulos 600; display 600–700. Evite 300 em fundo claro (contraste) e 800–900 salvo identidade.
- Hierarquia por **tamanho + peso + cor**, não só peso.

### Medida e outros

- Texto corrido: 45–75 caracteres por linha (`max-width: 65ch`).
- Números em tabelas e dashboards: `font-variant-numeric: tabular-nums`.
- Truncamento: `text-overflow: ellipsis` em uma linha ou `-webkit-line-clamp` em várias; sempre com título completo acessível (`title` ou tooltip) quando a informação importa.
- `text-wrap: balance` em títulos; `text-wrap: pretty` em parágrafos (progressivo).

## 2. Espaçamento

Base 4 px. Escala:

| Token | px | Uso típico |
|---|---|---|
| `0.5` | 2 | ajustes ópticos |
| `1` | 4 | gap entre ícone e texto pequeno |
| `2` | 8 | padding interno compacto; gap em grupos densos |
| `3` | 12 | padding de input/botão vertical |
| `4` | 16 | padding padrão de card e botão horizontal; gap entre campos |
| `5` | 20 | — |
| `6` | 24 | padding de card generoso; gap entre grupos |
| `8` | 32 | separação entre blocos |
| `10` | 40 | — |
| `12` | 48 | separação entre seções em app |
| `16` | 64 | separação entre seções em landing (compacto) |
| `20` | 80 | — |
| `24` | 96 | separação entre seções em landing |
| `32` | 128 | hero, respiros grandes |

Regras:
- Dentro de um grupo: 4–12. Entre grupos relacionados: 16–24. Entre seções: 32–96.
- Use a mesma unidade em todo o eixo: um card com padding 24 tem gap interno 16 ou 12, nunca 14.
- `gap` em vez de margem em flex/grid. Margem só em fluxo de texto (`margin-block`).
- Padding horizontal de botão ≈ 1,5–2× o vertical.
- Alinhamento óptico: ícone dentro de botão pode precisar de −1/−2 px; textos em caixa alta pequena "sobem" e podem pedir ajuste.

## 3. Cor

### Neutros

Nunca cinza puro. Neutros com leve tinta (0,5–3 % de saturação) na direção do acento ou levemente fria ficam mais "caros". Escala de 12 passos (estilo Radix), do mais claro ao mais escuro:

| Passo | Papel no tema claro |
|---|---|
| 1 | fundo da aplicação |
| 2 | fundo sutil (sidebar, zebra) |
| 3 | superfície de componente (input, card leve) |
| 4 | componente hover |
| 5 | componente ativo/selecionado |
| 6 | borda sutil |
| 7 | borda de UI com ênfase |
| 8 | borda de controles (inputs, checkboxes) e anel de foco — deve atingir ≥ 3:1 sobre o fundo |
| 9 | cor sólida (raramente em neutro) |
| 10 | sólido hover |
| 11 | texto secundário (contraste ≥ 4.5:1 sobre 1–3) |
| 12 | texto primário |

No tema escuro a mesma lógica se aplica de forma invertida, mas **não inverta a paleta**: gere a escala escura separadamente, com o passo 1 em torno de L≈10–13 % e superfícies elevadas mais claras que o fundo.

### Acento

- Um acento para ação primária, links, estado ativo, foco. Escolha com contraste ≥ 4.5:1 do texto sobre ele (texto branco sobre acento passo 9 costuma exigir L ≈ 45–55 %).
- Um segundo acento só se o produto precisar de duas famílias de ação (raro).
- Hover: um passo mais escuro no claro, um passo mais claro no escuro. Active: dois passos.
- Superfícies "tintadas" do acento (passos 2–4) para seleção, badges e realces, nunca o sólido em grandes áreas.

### Semânticas

| Papel | Matiz aproximado | Uso |
|---|---|---|
| Sucesso | verde 140–160° | confirmação, positivo |
| Aviso | âmbar 35–45° | atenção, reversível |
| Erro/Perigo | vermelho 0–15° | erro, ação destrutiva |
| Info | azul 210–230° | informação neutra |

Cada semântica precisa de: sólido, texto (contraste AA sobre superfície), superfície tintada e borda. Não use vermelho como cor de marca; use o acento para ação primária e o vermelho só para destruição/erro.

### Papéis (tokens semânticos)

Sempre exponha cores por papel, nunca por valor bruto nos componentes:

`bg`, `bg-subtle`, `surface`, `surface-raised`, `surface-overlay`, `border`, `border-strong`, `border-input`, `text`, `text-muted`, `text-subtle`, `text-on-accent`, `accent`, `accent-hover`, `accent-active`, `accent-subtle`, `accent-text`, `focus-ring`, `success-*`, `warning-*`, `danger-*`, `info-*`.

### Contraste (WCAG 2.2 AA)

- Texto normal: ≥ 4.5:1. Texto grande (≥ 24 px ou ≥ 18,66 px negrito): ≥ 3:1.
- Componentes de UI e gráficos: ≥ 3:1 contra adjacentes.
- Foco visível: ≥ 3:1 contra fundo e contra o componente.
- Estado desabilitado está isento, mas deve continuar legível (≈ 3:1).
- Use OKLCH para gerar escalas: luminosidade perceptualmente uniforme facilita acertar contraste.

## 4. Raio

| Token | px | Uso |
|---|---|---|
| `xs` | 2 | checkbox pequeno, tags densas |
| `sm` | 4 | inputs e botões compactos, células |
| `md` | 6–8 | botões, inputs, badges padrão |
| `lg` | 12 | cards, popovers |
| `xl` | 16 | modais, painéis, imagens grandes |
| `2xl` | 24 | superfícies hero, mobile sheets |
| `full` | 9999 | pill, avatar |

Regra de aninhamento: raio interno = raio externo − distância entre as bordas (padding). Um card com raio 12 e padding 8 tem imagem interna com raio 4. Escolha **um** nível de arredondamento como personalidade (quadrado/sm, médio/md, arredondado/lg+) e seja consistente.

## 5. Elevação

Escolha **uma** lógica principal:

- **Bordas** (moderno, denso, ferramentas): `1px solid border` e no máximo uma sombra suave para overlays.
- **Sombras** (mais suave, produtos de consumo): sombras em camadas, sempre com leve tinta da cor do texto, nunca preto puro.

Escala de sombras (tema claro; cor base = `text` com alpha):

| Nível | Uso | Valor sugerido |
|---|---|---|
| `xs` | separação sutil de superfície | `0 1px 2px 0 rgb(17 24 39 / .05)` |
| `sm` | card em repouso | `0 1px 3px 0 rgb(17 24 39 / .08), 0 1px 2px -1px rgb(17 24 39 / .06)` |
| `md` | card hover, dropdown | `0 4px 6px -1px rgb(17 24 39 / .08), 0 2px 4px -2px rgb(17 24 39 / .06)` |
| `lg` | popover, drawer | `0 10px 15px -3px rgb(17 24 39 / .10), 0 4px 6px -4px rgb(17 24 39 / .06)` |
| `xl` | modal | `0 20px 25px -5px rgb(17 24 39 / .12), 0 8px 10px -6px rgb(17 24 39 / .06)` |

Tema escuro: sombras quase não aparecem. Eleve por luminosidade de superfície (`surface-raised` mais clara que `surface`) e por borda de 1 px com alpha baixo (`rgb(255 255 255 / .08)`). Um `inset 0 1px 0 rgb(255 255 255 / .04)` no topo simula luz.

## 6. Movimento

| Token | ms | Uso |
|---|---|---|
| `instant` | 0 | mudanças de estado que não devem parecer animadas |
| `fast` | 120 | hover, foco, toggles, cor |
| `base` | 200 | aparecer/desaparecer de pequenos elementos, dropdown |
| `slow` | 300 | modais, drawers, expansão de painéis |
| `slower` | 500 | transições de página, ilustrações |

Easings:
- Entrada: `cubic-bezier(0, 0, 0.2, 1)` (ease-out) — elementos chegando desaceleram.
- Saída: `cubic-bezier(0.4, 0, 1, 1)` (ease-in) — elementos saindo aceleram; saída ligeiramente mais rápida que entrada.
- Movimento em tela: `cubic-bezier(0.4, 0, 0.2, 1)` (standard).
- Elástico/spring só para feedback lúdico e nunca em ferramentas de trabalho.

Regras: anime `opacity` e `transform` (compostos pela GPU), não `width/height/top/left`; nunca loop decorativo; sempre `@media (prefers-reduced-motion: reduce)` reduzindo para `transition-duration: 0.01ms` ou removendo deslocamento.

## 7. Breakpoints e contêineres

| Nome | min-width | Contexto |
|---|---|---|
| `sm` | 640 | celular paisagem |
| `md` | 768 | tablet retrato |
| `lg` | 1024 | tablet paisagem / laptop pequeno |
| `xl` | 1280 | desktop |
| `2xl` | 1536 | desktop grande |

- Projete mobile-first; adicione complexidade ao crescer.
- Container de leitura: 65–75 ch. Container de conteúdo: 1200–1280 px. Container largo (dashboard): 1440–1600 px ou fluido com padding lateral `clamp(16px, 4vw, 48px)`.
- Prefira **container queries** (`@container`) em componentes reutilizáveis; media queries para o layout da página.
- Grid fluido sem breakpoint: `grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr))`.

## 8. Z-index

Escala nomeada; nunca números soltos:

| Token | Valor | Uso |
|---|---|---|
| `base` | 0 | fluxo |
| `raised` | 10 | elementos sobrepostos localmente |
| `sticky` | 100 | header/sidebar fixos |
| `dropdown` | 1000 | menus, popovers |
| `overlay` | 1100 | backdrop |
| `modal` | 1200 | diálogos, drawers |
| `toast` | 1300 | notificações |
| `tooltip` | 1400 | tooltips |

## 9. Ícones

- Um conjunto só (Lucide, Phosphor, Heroicons, Tabler, Material Symbols). Não misture.
- Tamanhos: 16 (inline em texto sm), 20 (botões, inputs, navegação), 24 (headers, ações principais). Stroke 1,5–2 px consistente.
- Ícone alinhado ao `line-height` do texto vizinho; cor herdada (`currentColor`).
- Ícone isolado precisa de rótulo acessível (`aria-label` no botão) e, geralmente, tooltip.
- Nunca emoji como ícone de interface.

## 10. Controles e alvos

- Altura de controles: compacto 32, padrão 36–40, grande 44–48. Alinhe botão e input do mesmo tamanho na mesma altura.
- Alvo de toque mínimo 24×24 (WCAG 2.2), recomendado 44×44 em mobile.
- Foco: anel de 2 px, offset 2 px, cor do acento ou `focus-ring`, visível em todo controle (`:focus-visible`).
- Cursor: `pointer` só em elementos clicáveis que não são botões/links nativos; desabilitado usa `not-allowed`.

## 11. Layout e malha

- Malha de 12 colunas com gutter 24 (desktop) / 16 (mobile) para páginas; em app, layout por regiões (`grid-template-areas`).
- Alinhe tudo a múltiplos de 4; distâncias de 8 são o padrão visual.
- Larguras fixas para elementos previsíveis (sidebar 240–280, painel lateral 320–400), fluidas para conteúdo.
- Altura de linha de tabela: densa 36, padrão 44–48, confortável 56.

## 12. Imagens e mídia

- Sempre `width`/`height` ou `aspect-ratio` reservados (sem CLS).
- `object-fit: cover` com `object-position` intencional.
- Formatos AVIF/WebP com fallback; `srcset`/`sizes` corretos; `loading="lazy"` fora da dobra; `fetchpriority="high"` só na imagem LCP.
- Placeholder de cor dominante ou blur, nunca um "quadrado quebrado".
- Ilustrações e fotos com a mesma temperatura de cor da paleta.
