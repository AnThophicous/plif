# Exemplos — pedido, diagnóstico, decisões, entrega

Três casos típicos mostrando como a skill raciocina. O nível de detalhe da entrega final é o esperado em qualquer trabalho real.

---

## Exemplo 1 — "Faz a landing page do produto ficar profissional, tá parecendo template"

**Contexto encontrado no diagnóstico**
- Next.js 15 + Tailwind 4, sem `tailwind.config` de tokens; cores hard-coded em classes (`bg-purple-600`, `from-indigo-500 to-pink-500`).
- Hero centralizado com gradiente roxo, dois blobs desfocados, título "Potencialize sua produtividade com IA", grid 3×2 de features com emojis.
- Fonte Inter em 5 pesos via Google Fonts; nenhum tema escuro.
- Lighthouse mobile: Performance 61 (LCP 4,8 s por imagem hero de 2,1 MB), CLS 0,21 (fontes + imagens sem dimensão).

**Decisões**
1. **Sistema:** criar `@theme` no CSS do Tailwind 4 com tokens de [`sistema-de-design.md`](sistema-de-design.md): neutro com leve tinta fria, acento único (o azul-petróleo do logo, L≈48 % para AA com texto branco), raio `md` como personalidade, elevação por borda.
2. **Assinatura:** display em serif contemporânea (ex.: Instrument Serif, só peso 400) para títulos de seção, corpo em Inter 400/500/600. Uma decisão repetida em todas as seções.
3. **Hero:** alinhado à esquerda em desktop, grid 7/5; título de 7 palavras que diz o que o produto faz ("Relatórios financeiros prontos em minutos, não em dias"); subtítulo de 2 frases; CTA primário "Começar grátis" + secundário "Ver demonstração"; à direita screenshot real do produto em moldura discreta com borda e sombra `md`. Sem gradiente, sem blobs.
4. **Features:** grid 3×2 → três blocos alternados imagem/texto, cada um um benefício com screenshot recortado. Detalhes técnicos vão para um grid denso de 6 itens de 1 linha, sem ícones.
5. **Prova social:** logos reais em cinza uniforme; dois depoimentos com nome, cargo, empresa e foto fornecidos pelo cliente (placeholders declarados até chegarem).
6. **Ritmo:** seções com `py-24 md:py-32`, fundo alternando `bg` e `bg-subtle`; container `max-w-6xl`; texto ≤ 65 ch.
7. **Performance:** hero em AVIF 1600 px com `srcset`, `fetchpriority="high"`, `sizes` corretos; fontes self-hosted com subset latin e `size-adjust`; `aspect-ratio` em todas as imagens; animações de entrada removidas (mantida só uma opacidade de 200 ms no hero com `prefers-reduced-motion`).
8. **Acessibilidade:** headings em ordem (h1 no hero, h2 por seção), landmarks, contraste verificado, foco visível no acento, skip link.

**Entrega**
- O que mudou: tokens, tipografia, hero, features, prova social, ritmo vertical, imagens, fontes.
- Verificado: `lint`, `typecheck`, `build`; Lighthouse mobile Performance 96 / A11y 100 / BP 100; LCP 1,6 s; CLS 0,00; visual em 375 e 1440 px; navegação por teclado completa.
- Pendente: depoimentos e logos reais (placeholders marcados com `data-placeholder`); tema escuro fora do escopo.

---

## Exemplo 2 — "Cria a tela de listagem de pedidos no admin"

**Contexto encontrado no diagnóstico**
- React 19 + Vite + CSS Modules + design tokens próprios em `src/styles/tokens.css` (bem definidos). Componentes `Button`, `Input`, `Badge`, `Table` já existem; `Table` não tem estado vazio nem skeleton.
- Padrão do projeto: page header com `PageTitle` + ações à direita; tabelas usam `useQuery` com `isLoading/isError`.
- Endpoint de pedidos: paginação server-side, filtros por status/data/cliente, ordenação.

**Decisões**
1. **Reutilizar tudo**: nenhum token, cor ou componente novo. Estender `Table` com props `emptyState` e `skeletonRows` (contrato aditivo, sem quebrar usos existentes).
2. **Hierarquia**: h1 "Pedidos" + contagem total em `text-muted`; ação primária "Novo pedido"; toolbar com busca (cliente/ID), filtro de status (multi), período (preset + custom), botão "Limpar filtros" visível só quando há filtro ativo.
3. **Tabela**: colunas ID (mono, largura fixa), Cliente (fluida, truncada com tooltip), Data (fixa), Itens (número à direita), Total (número à direita `tabular-nums`, formato `Intl.NumberFormat`), Status (badge: neutro para "Processando", sucesso para "Entregue", aviso para "Aguardando pagamento", perigo para "Cancelado"), Ações (ver + menu ⋯ sempre visíveis). Altura de linha 44; cabeçalho fixo; ordenação por Data e Total.
4. **Estados**: skeleton de 8 linhas com a geometria das colunas (após 300 ms); vazio de primeiro uso ("Nenhum pedido ainda" + "Novo pedido"); sem resultados de filtro ("Nenhum pedido para os filtros aplicados" + "Limpar filtros"); erro isolado no bloco da tabela com "Tentar de novo"; paginação com total e itens por página.
5. **Mobile** (`< md`): toolbar empilha; tabela vira lista de cards (ID + cliente + total + status + data) usando o mesmo componente com prop `layout="cards"` via container query.
6. **A11y**: `caption` visualmente oculto; `aria-sort` na coluna ordenada; filtros com labels; live region anunciando "N pedidos encontrados" ao filtrar; foco retorna à tabela após paginar.
7. **Performance**: sem virtualização (máximo 50 por página); `React.memo` só em `Row` porque re-renderizava a cada tecla da busca (medido no Profiler).

**Entrega**
- O que mudou: `pages/Orders`, `components/Table` (aditivo), `hooks/useOrdersQuery`, testes.
- Verificado: `lint`, `typecheck`, `vitest` (12 testes novos: filtros, estados, formatação, ordenação); Playwright com axe: 0 violações; visual em 375/768/1440; teclado completo.
- Pendente: exportar CSV (fora do escopo; sugerido como próximo).

---

## Exemplo 3 — "O modal de confirmação está estranho, arruma"

**Contexto encontrado no diagnóstico**
- Vue 3 + Nuxt + Tailwind 3 com tokens em `tailwind.config`. Modal customizado em `div` com `v-if`, sem `role`, sem foco preso, fecha só no X; botões "Sim" e "Não" ambos primários; `scale(1.1)` no hover; texto centralizado com 3 parágrafos.
- Usado em 14 lugares, 6 deles para exclusão.

**Decisões**
1. **Base nativa**: migrar para `<dialog>` com `showModal()`, preservando a API do componente (`v-model:open`, slots `title`/`body`/`actions`) para não tocar os 14 usos. Foco preso, `Esc` e backdrop de graça; retorno de foco implementado.
2. **Anatomia**: largura 400 (confirmação) / 560 (formulário) via prop `size`; header com h2 (`aria-labelledby`), corpo alinhado à esquerda com uma frase de consequência, footer com "Cancelar" (secundário) e ação primária com verbo + objeto vinda do chamador.
3. **Variante destrutiva**: prop `destructive` → botão `danger`, foco inicial no "Cancelar", ícone de alerta discreto no header.
4. **Movimento**: entrada 200 ms opacity + `translateY(8px)`, saída 150 ms; sem scale; `prefers-reduced-motion` reduz a 0,01 ms.
5. **Microcopy**: substituídos os 6 "Tem certeza? Sim/Não" por títulos específicos ("Excluir cliente 'Acme'?") e botões ("Excluir cliente").

**Entrega**
- O que mudou: `components/ConfirmDialog.vue`, 6 chamadores (só textos), 1 teste de a11y.
- Verificado: `lint`, `typecheck`, `vitest`; teclado (Tab preso, Esc fecha, foco retorna); leitor de tela anuncia título e papel; visual em 375 e 1440; tema escuro.
- Pendente: os outros 8 chamadores mantêm textos antigos ("OK"), listados para revisão de conteúdo.
