# Checklist de acessibilidade — WCAG 2.2 AA aplicado

Marque cada item ao verificar. Itens com **(2.2)** são novos ou alterados na WCAG 2.2.

## Estrutura e semântica

- [ ] Um único `h1` por página; headings em ordem sem pular níveis; cada seção relevante tem heading.
- [ ] Landmarks: `header`, `nav` (com `aria-label` se houver mais de um), `main` (um só), `aside`, `footer`.
- [ ] Listas são `ul`/`ol`; tabelas de dados são `table` com `th` e `scope`/`headers`; tabelas não são usadas para layout.
- [ ] Botões são `button`; navegação é `a href`. Nada de `div onClick`.
- [ ] `lang` correto no `html` e em trechos em outro idioma.
- [ ] Título da página (`<title>`) único e descritivo, muda em SPAs a cada rota.
- [ ] Ordem do DOM = ordem visual = ordem de leitura. Sem `order`/`flex-direction: row-reverse` que inverta a leitura lógica.
- [ ] Link "pular para o conteúdo" como primeiro elemento focável em páginas com navegação extensa.

## Teclado

- [ ] Tudo o que é clicável é alcançável com Tab e ativável com Enter/Espaço; menus e listas navegáveis com setas quando apropriado (padrão APG).
- [ ] Ordem de Tab lógica; sem `tabindex` positivo.
- [ ] Sem armadilha de foco (exceto dentro de modal aberto, com `Esc` para sair).
- [ ] Foco visível em **todo** elemento interativo: anel ≥ 2 px, contraste ≥ 3:1 contra fundo e componente; use `:focus-visible`. **(2.2 — 2.4.11 Foco não obscurecido)**: o elemento focado não fica escondido por header fixo, sticky footer ou toast.
- [ ] Modal/drawer: foco vai para dentro ao abrir, fica preso, volta ao elemento que abriu ao fechar.
- [ ] Atalhos de uma tecla só podem ser desativados ou remapeados, ou ativos só com foco no componente.
- [ ] Dropdown/menu fecha com `Esc`; foco retorna ao gatilho.

## Formulários

- [ ] Todo campo tem `label` visível associado (`for`/`id` ou encapsulamento). Placeholder não substitui label.
- [ ] Grupos relacionados em `fieldset` + `legend` (radios, checkboxes, endereço).
- [ ] Ajuda e erro ligados ao campo por `aria-describedby`; campo inválido com `aria-invalid="true"`.
- [ ] Erro descreve o problema **e** como corrigir; aparece perto do campo; não depende só de cor.
- [ ] No `submit` com erros: foco no primeiro campo inválido ou em um resumo com links para os campos.
- [ ] `autocomplete` correto (`name`, `email`, `tel`, `postal-code`, `username`, `current-password`, `new-password`, `one-time-code`, `cc-number`…).
- [ ] Tipos de input corretos (`email`, `tel`, `number` só para quantidades, `url`, `date` quando bem suportado).
- [ ] **(2.2 — 3.3.7 Entrada redundante)**: não peça de novo o que o usuário já informou no mesmo fluxo; ofereça preencher automaticamente.
- [ ] **(2.2 — 3.3.8 Autenticação acessível)**: login não exige teste cognitivo (transcrever, resolver puzzle); permite colar senha e usar gerenciador de senhas.
- [ ] Campos obrigatórios/opcionais identificados por texto, não só por asterisco colorido (ou asterisco explicado).
- [ ] Ações destrutivas ou financeiras: confirmação, revisão ou possibilidade de desfazer.

## Cor e contraste

- [ ] Texto normal ≥ 4.5:1; texto grande (≥ 24 px, ou ≥ 18,66 px em negrito) ≥ 3:1.
- [ ] Componentes de UI (bordas de input, ícones funcionais, indicadores) ≥ 3:1 contra adjacentes.
- [ ] Informação nunca só por cor: status tem ícone ou texto; links no meio do texto têm sublinhado ou contraste ≥ 3:1 com o texto ao redor + indicador no hover/foco; gráficos têm padrão, rótulo ou legenda direta.
- [ ] Verificado nos dois temas (claro e escuro).
- [ ] Estado desabilitado ainda legível (≈ 3:1), mesmo isento pela norma.

## Alvos e ponteiro

- [ ] **(2.2 — 2.5.8 Tamanho do alvo)**: alvos ≥ 24×24 CSS px ou espaçados o suficiente; recomendado 44×44 em mobile.
- [ ] Funcionalidades por arrastar (**2.2 — 2.5.7**) têm alternativa por clique/teclado (ex.: reordenar com botões subir/descer).
- [ ] Ações que aparecem só no hover também estão disponíveis no foco e no toque (ou são sempre visíveis).
- [ ] Sem dependência de gestos complexos sem alternativa.

## Conteúdo dinâmico e ARIA

- [ ] ARIA só quando o HTML nativo não resolve; papéis, estados e propriedades corretos (`aria-expanded`, `aria-selected`, `aria-current`, `aria-pressed`, `aria-controls`).
- [ ] Mensagens de status (salvo, itens carregados, resultados encontrados) em `role="status"`/`aria-live="polite"`; erros críticos em `role="alert"`.
- [ ] Conteúdo que aparece no hover/foco (tooltip, popover) é dispensável (`Esc`), permanece ao mover o ponteiro sobre ele e persiste até ação do usuário.
- [ ] Carregamento comunica progresso: `aria-busy`, texto em live region, ou `progressbar` com valores.
- [ ] Nomes acessíveis únicos e descritivos: "Editar projeto Alfa", não vários "Editar".
- [ ] Ícones isolados têm `aria-label` no controle; ícones decorativos têm `aria-hidden="true"`.
- [ ] Componentes compostos (tabs, accordion, combobox, menu, dialog, tree) seguem os padrões do WAI-ARIA APG ou usam primitivos acessíveis (Radix, React Aria, Headless UI, `<dialog>`, Popover API).

## Mídia e imagens

- [ ] `alt` descreve função ou conteúdo; `alt=""` para decorativas; imagens de texto evitadas.
- [ ] Vídeo com legendas; áudio com transcrição; nada toca automaticamente com som.
- [ ] Animações que piscam > 3×/s não existem.
- [ ] `prefers-reduced-motion: reduce` desativa deslocamentos, paralaxe, autoplay e loops.

## Zoom, texto e responsividade

- [ ] Zoom de 200 % (ou 400 % em 1280 px) sem perda de conteúdo ou função; sem scroll horizontal em 320 px de largura de viewport.
- [ ] Texto em `rem`/`em`, não `px` fixo; layouts não quebram ao aumentar só o tamanho da fonte.
- [ ] Espaçamento de texto ajustável (line-height 1,5, parágrafo 2×, letra 0,12 em, palavra 0,16 em) sem cortar conteúdo.
- [ ] Orientação retrato e paisagem funcionam.
- [ ] Sem `user-scalable=no` nem `maximum-scale=1`.

## Verificação prática

1. Navegue a tela inteira só com teclado (Tab, Shift+Tab, Enter, Espaço, Esc, setas). Consegue fazer tudo? Sempre sabe onde está o foco?
2. Rode um leitor de tela (VoiceOver, NVDA, Orca, TalkBack) pelo fluxo principal: os nomes fazem sentido? A ordem faz sentido? Mudanças dinâmicas são anunciadas?
3. Rode axe DevTools / Lighthouse Accessibility / `@axe-core/playwright` em testes. Zero violações críticas e sérias.
4. Verifique contraste com ferramenta (Polypane, Stark, WebAIM) nos dois temas.
5. Emule `prefers-reduced-motion` e `prefers-color-scheme` no DevTools.
6. Zoom 200 % e viewport 320 px.
7. Declare o que não pôde ser verificado (ex.: leitor de tela indisponível).
