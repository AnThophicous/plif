# Checklist de responsividade e performance

## Responsividade

### Estratégia

- [ ] Mobile-first: estilos base para telas pequenas, `min-width` para crescer.
- [ ] Breakpoints do sistema (640/768/1024/1280/1536) ou os do projeto; não criar breakpoints ad hoc por componente.
- [ ] Componentes reutilizáveis adaptam-se ao **container** (`@container`), não à viewport.
- [ ] Tipografia e espaçamento fluidos com `clamp()` onde a variação é grande (hero, seções de landing).
- [ ] Grids com `auto-fit`/`auto-fill` + `minmax(min(100%, Xpx), 1fr)` para evitar breakpoints em grades de cards.
- [ ] Unidades lógicas (`padding-inline`, `margin-block`, `inset-inline-start`) quando o projeto suporta RTL ou por padrão.
- [ ] `dvh`/`svh` em vez de `vh` para alturas de tela em mobile (barra de endereço).
- [ ] Safe areas em dispositivos com notch: `env(safe-area-inset-*)` em barras fixas.

### Verificar em

- [ ] 360 e 390 px (celulares comuns), 768 (tablet), 1024, 1280–1440 (desktop), 1920 (grande).
- [ ] Retrato e paisagem em mobile.
- [ ] Zoom 200 %.
- [ ] Conteúdo curto, longo, vazio e extremo em cada breakpoint.

### O que costuma quebrar

- [ ] Overflow horizontal por elemento com largura fixa, `white-space: nowrap`, tabela ou imagem sem `max-width: 100%`.
- [ ] Texto truncado sem acesso ao conteúdo completo.
- [ ] Botões lado a lado que não cabem: empilhar em `< sm`.
- [ ] Tabelas: scroll horizontal com primeira coluna fixa ou conversão em cards.
- [ ] Modais mais altos que a viewport: corpo com scroll, header/footer fixos; em mobile virar sheet/full-screen.
- [ ] Navegação: sidebar → drawer; tabs → scroll horizontal com indicador ou select.
- [ ] Hover como único meio de revelar algo (não existe em toque).
- [ ] Alvos de toque < 44 px próximos demais.
- [ ] Fixed/sticky que cobrem conteúdo ou o foco.
- [ ] Imagens com `height` fixa que distorcem ou cortam o assunto (`object-fit`/`object-position`).

## Performance

### Metas (Core Web Vitals, p75 em campo)

| Métrica | Bom | Precisa melhorar | Ruim |
|---|---|---|---|
| LCP (Largest Contentful Paint) | ≤ 2,5 s | 2,5–4 s | > 4 s |
| INP (Interaction to Next Paint) | ≤ 200 ms | 200–500 ms | > 500 ms |
| CLS (Cumulative Layout Shift) | ≤ 0,1 | 0,1–0,25 | > 0,25 |

Complementares: TTFB ≤ 800 ms; FCP ≤ 1,8 s; JS total de rota inicial ≤ 200 kB gzip em produtos comuns (orçamento do projeto vale mais que este número).

### Carregamento

- [ ] Imagem do LCP: `fetchpriority="high"`, sem `loading="lazy"`, `preload` se for CSS background, dimensões explícitas, formato moderno, tamanho adequado ao container (`srcset`/`sizes`).
- [ ] Demais imagens: `loading="lazy"`, `decoding="async"`, `width`/`height` ou `aspect-ratio`.
- [ ] Fontes: self-hosted ou `preconnect`; `font-display: swap` (ou `optional` em UI); subset (latin); apenas pesos usados; `size-adjust`/métricas de fallback para reduzir CLS na troca.
- [ ] CSS crítico inline ou pequeno; sem CSS bloqueante de bibliotecas inteiras.
- [ ] Scripts de terceiros (analytics, chat) adiados (`defer`, após carregamento, ou via Partytown/worker).
- [ ] Code splitting por rota; componentes pesados (editor, gráfico, mapa) carregados sob demanda (`dynamic import`, `lazy`).
- [ ] Sem bibliotecas para o que CSS/HTML resolve (carousel simples, tooltip, modal, accordion).
- [ ] Cache e compressão (Brotli) configurados; assets com hash.

### Renderização e interação

- [ ] Sem layout shift: reserve espaço para imagens, embeds, anúncios, skeletons com a mesma geometria, fontes com fallback ajustado; não insira conteúdo acima do que já está visível.
- [ ] Animações só em `transform`/`opacity`; `will-change` com moderação; evite animar `box-shadow` (anime um pseudo-elemento com opacity).
- [ ] Listas longas (> 200 itens) virtualizadas.
- [ ] Evite re-renderizações desnecessárias: estado no nível certo, memoização proporcional, chaves estáveis, seletores de estado granulares.
- [ ] Handlers de input, scroll e resize com `debounce`/`throttle` ou `requestAnimationFrame`; trabalho pesado fora do handler (`startTransition`, `scheduler.yield`, worker).
- [ ] `content-visibility: auto` em seções longas fora da viewport quando apropriado.
- [ ] Hidratação: componentes estáticos não precisam de JS (server components, islands); sem mismatch de hidratação no console.
- [ ] Sem `setInterval` desnecessário; `IntersectionObserver` para lazy loading e animações de entrada.

### Verificação

1. Lighthouse (mobile, throttling) nas telas alteradas: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95.
2. Painel Performance do DevTools: sem long tasks > 50 ms na interação principal; sem layout shifts registrados.
3. Aba Network: peso total da rota, quantidade de requisições, fontes e imagens redimensionadas corretamente.
4. `npm run build` (ou equivalente) e inspecione o tamanho dos bundles; compare com o baseline antes da mudança.
5. Teste em CPU 4× mais lenta e 3G rápido no DevTools.
6. Declare o que não pôde ser medido.
