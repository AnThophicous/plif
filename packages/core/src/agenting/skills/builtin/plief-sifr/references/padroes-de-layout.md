# Padrões de layout — anatomia, hierarquia e erros comuns

Para cada padrão: estrutura esperada, decisões que importam, estados obrigatórios e o que costuma sair errado. Combine com [`sistema-de-design.md`](sistema-de-design.md) para os valores.

## 1. App shell (aplicação autenticada)

**Estrutura**

```
┌──────────────────────────────────────────────┐
│ header (opcional): busca global, ações, user │
├────────────┬─────────────────────────────────┤
│ sidebar    │ page header: título, breadcrumb, │
│ 240–280px  │              ação primária        │
│ nav por    ├─────────────────────────────────┤
│ seções     │ conteúdo (max-width ou fluido)   │
│            │                                  │
│ footer nav │                                  │
└────────────┴─────────────────────────────────┘
```

**Decisões**
- Sidebar com grupos rotulados, item ativo com superfície tintada do acento (não sólido), ícone 20 + label 14/500.
- Colapsável em `lg`; vira drawer em `< md`. Estado persiste.
- Page header sempre com título h1 e ação primária no canto direito; breadcrumb só se a profundidade > 2.
- Conteúdo com padding `clamp(16px, 3vw, 32px)`; `max-width` 1440–1600 para leitura em telas ultra largas.

**Erros comuns:** sidebar e header competindo em cor; item ativo sem contraste suficiente; page header sem ação primária; conteúdo colado nas bordas em mobile; scroll duplo (body + main).

## 2. Dashboard

**Estrutura:** page header com filtros globais (período, segmento) → KPIs (3–5 cards) → gráfico principal → secundários/tabela.

**Decisões**
- KPI card: rótulo 12–14/500 em `text-muted` (caixa normal, não caixa alta gritante), valor 30–36/600 `tabular-nums`, variação com seta e cor semântica **mais** texto ("+12,4 % vs. mês anterior"). Sem ícone decorativo grande.
- Gráficos: um acento para a série principal, neutros para comparação; grid horizontal sutil, eixo sem bordas pesadas, tooltip com todos os valores. Legenda só se houver > 1 série.
- Hierarquia por tamanho de área: o que importa ocupa mais espaço. Grid 12 colunas; KPIs 3 col cada, gráfico principal 8 + painel 4.
- Densidade compacta: gap 16, padding de card 20.

**Estados:** carregando (skeleton com a mesma geometria), vazio ("Sem dados para o período. Ajuste os filtros."), erro com "Tentar de novo", parcial (alguns widgets falham, o resto funciona).

**Erros comuns:** todos os cards do mesmo tamanho (sem hierarquia); cores aleatórias em gráficos; números sem formatação de milhar/decimal; gradientes em cards; ícones enormes em KPI.

## 3. Landing page

**Estrutura narrativa** (cada seção responde a uma pergunta do visitante):

1. **Hero** — "O que é e por que me importa?" Título 48–72 fluido, no máximo 8–10 palavras, subtítulo 18–20 com 1–2 frases, CTA primário + secundário, prova visual do produto (screenshot real, não ilustração genérica). Alinhado à esquerda em desktop costuma parecer mais premium que centralizado.
2. **Prova social** — "Quem mais usa?" Logos em cinza uniforme ou 1–2 depoimentos com nome, cargo e foto reais.
3. **Problema → solução** — "Isso é para mim?" Uma seção que nomeia a dor.
4. **Funcionalidades como narrativa** — "Como funciona?" 3–4 blocos alternados imagem/texto, cada um com um benefício (não um recurso). Evite grade de 6 ícones com 3 linhas de texto cada.
5. **Detalhes/diferenciais** — grid denso é aceitável aqui, com títulos curtos e texto de 1 linha.
6. **Preços** (se aplicável) — 2–3 planos, o recomendado com destaque via borda/acento e badge, features em lista com check discreto, preço grande e claro, período visível, CTA por plano.
7. **FAQ** — accordion, 5–8 perguntas reais.
8. **CTA final** — repete a promessa do hero com uma frase e um botão.
9. **Footer** — colunas de links, legal, idioma/tema.

**Decisões**
- Ritmo vertical: seções com padding-block 96–128 desktop / 64 mobile; alterne fundo `bg` e `bg-subtle` para separar sem linhas.
- Uma assinatura visual (tipografia de display, tratamento de imagem, cor) repetida em todas as seções.
- Container 1200–1280; texto corrido ≤ 65 ch.
- Animações de entrada só sutis (opacity + 8–16 px translate), uma vez, com `prefers-reduced-motion`.

**Erros comuns:** hero centralizado com gradiente roxo e blobs; título genérico ("Potencialize sua produtividade"); grid de features com emojis; depoimentos falsos; três CTAs competindo; seções sem respiro; imagens de stock.

## 4. Formulário

**Estrutura:** título e propósito → grupos de campos (fieldset/legend) → ação primária à esquerda ou alinhada ao conteúdo (em modais, à direita) → cancelamento como botão secundário/ghost.

**Decisões**
- Uma coluna por padrão; duas apenas para campos curtos relacionados (CEP/número, nome/sobrenome). Nunca mais de duas.
- Label sempre visível acima do campo (não placeholder como label); ajuda opcional abaixo em `text-muted` 13–14; erro abaixo em `danger-text` com ícone e texto que diz como corrigir.
- Campo: altura 40, padding-inline 12, borda 1 px `border`, raio md, foco com anel + borda acento.
- Largura do campo proporcional ao conteúdo esperado (CEP curto, e-mail longo).
- Validação: no `blur` do campo ou no `submit`; nunca enquanto digita a primeira vez. Erros persistem até corrigidos. No `submit` com erros, foco no primeiro campo inválido e resumo no topo se forem muitos.
- Botão primário desabilitado só quando a ação é impossível; prefira habilitado + validação a desabilitar sem explicação. Estado de envio com spinner **e** texto ("Salvando…"), sem mudar a largura.
- Campos obrigatórios: marque os opcionais ("(opcional)") se a maioria for obrigatória, ou o contrário.

**Estados:** padrão, foco, preenchido, erro, desabilitado, somente leitura, carregando (envio), sucesso (confirmação clara e próximo passo).

**Erros comuns:** placeholder como único label; erro genérico ("campo inválido"); botão "Enviar"; formulário em 3 colunas; campos todos da mesma largura; select nativo sem estilização consistente; falta de `autocomplete`.

## 5. Tabela de dados

**Estrutura:** toolbar (busca, filtros, ações em lote, densidade) → cabeçalho fixo → linhas → paginação ou scroll infinito → estado vazio.

**Decisões**
- Alinhamento: texto à esquerda, números à direita (`tabular-nums`), datas à esquerda ou centro; cabeçalho segue a coluna.
- Altura de linha 44–48 padrão; 36 para densidade compacta. Zebra opcional com `bg-subtle`; hover com passo 2–3 do neutro.
- Cabeçalho 12–13/500 em `text-muted`, sem caixa alta obrigatória; indicador de ordenação só na coluna ativa.
- Ações por linha: no máximo 2 visíveis + menu "⋯"; aparecem sempre (não só no hover, por acessibilidade), podem ganhar contraste no hover.
- Colunas com larguras fixas para dados previsíveis (data, status) e fluidas para texto; truncar com tooltip.
- Seleção em lote: checkbox na primeira coluna, barra de ações substitui a toolbar quando há seleção.
- Em mobile: scroll horizontal com primeira coluna fixa **ou** converter em cards; decida por caso.

**Estados:** carregando (skeleton de linhas), vazio (com ação de criar), sem resultados de filtro ("Nenhum resultado para 'x'. Limpar filtros"), erro, muitos itens (virtualização a partir de ~200 linhas).

**Erros comuns:** bordas pesadas em todas as células; texto centralizado; números à esquerda; badges coloridos em excesso; ações que só aparecem no hover; cabeçalho que rola para fora.

## 6. Listagem + detalhe (master/detail)

- Lista à esquerda (320–400 px), detalhe à direita; item selecionado com superfície tintada; detalhe com header próprio (título, metadados, ações).
- Em `< lg`: lista ocupa a tela e o detalhe abre como rota/página com botão voltar.
- Lista com item de 2–3 linhas: título 14/500, subtítulo 13 `text-muted`, metadado à direita.
- Estado sem seleção no detalhe: mensagem discreta ("Selecione um item para ver os detalhes"), não uma tela vazia.

## 7. Autenticação (login, cadastro, recuperação)

- Card centralizado de 400–440 px **ou** split (formulário à esquerda 480 px, painel visual à direita). Nunca mais que isso.
- Logo, título ("Entrar na sua conta"), campos, ação primária full-width, alternativas (SSO) separadas por divisor "ou", link secundário (esqueci a senha / criar conta) em `text-muted`.
- Mostrar/ocultar senha; `autocomplete` correto (`username`, `current-password`, `new-password`, `one-time-code`).
- Erro de credencial genérico por segurança ("E-mail ou senha incorretos"), mas visível e junto do formulário.
- Campo de código de verificação com 6 caixas ou um input com espaçamento largo; aceitar colar.

## 8. Configurações

- Navegação por seções (tabs ou sub-sidebar), cada seção com grupos: título 16/600, descrição `text-muted`, controles à direita ou abaixo.
- Salvamento: automático por campo (toggle/select) com confirmação sutil, **ou** botão "Salvar" fixo no rodapé da seção que aparece quando há mudanças. Não misture.
- Ações destrutivas em zona separada no final, com borda `danger` sutil e confirmação em modal que exige digitar/confirmar.

## 9. Modal e drawer

- **Modal** para decisão focada e curta (confirmação, formulário pequeno). Largura 400 (confirmação), 560 (formulário), 720–960 (conteúdo). Raio xl, sombra xl, backdrop `rgb(0 0 0 / .4–.6)` com leve blur opcional.
- **Drawer** para edição em contexto ou detalhe longo. Largura 400–560 à direita; em mobile vira sheet inferior.
- Anatomia: header (título h2 + botão fechar), corpo com scroll próprio, footer com ações (primária à direita, cancelar à esquerda dela).
- Foco preso dentro; foco inicial no primeiro elemento útil (ou no título se for destrutivo); `Esc` fecha; retorno do foco ao elemento que abriu; `aria-modal`, `role="dialog"`, `aria-labelledby`. Use `<dialog>` nativo quando possível.
- Confirmação destrutiva: título dizendo o que acontece ("Excluir projeto 'X'?"), consequência em uma frase, botão vermelho com verbo ("Excluir projeto"), nunca "Sim/Não".

## 10. Toast, banner e alertas inline

- **Toast**: feedback transitório de ação (salvo, copiado). Canto inferior ou superior direito, 320–400 px, 4–6 s, pausa no hover, no máximo 3 empilhados, com ação opcional ("Desfazer"). Não use para erros que exigem ação.
- **Banner**: informação persistente de contexto (modo de teste, manutenção, versão nova). Topo da página ou da seção, fechável se não for crítico.
- **Alerta inline**: erro ou aviso ligado a um formulário/seção, ao lado do que descreve.
- Sempre: ícone semântico + texto; cor semântica na borda/ícone/superfície tintada, não fundo sólido saturado; `role="status"` (informativo) ou `role="alert"` (erro).

## 11. Estados de conteúdo

### Carregando
- Skeleton com **a mesma geometria** do conteúdo final (evita CLS); animação de shimmer sutil ou pulso lento; após 300 ms apenas (evite flash em cargas rápidas).
- Spinner só para ações pontuais (botão, refresh). Nunca uma tela inteira com spinner central se dá para mostrar a estrutura.
- Progress bar determinada quando o progresso é conhecido.

### Vazio
- Três tipos: **primeiro uso** (ensine e ofereça a ação de criar), **sem resultados** (mostre o filtro ativo e ofereça limpar), **tudo concluído** (celebre discretamente).
- Anatomia: ilustração ou ícone discreto (opcional, pequeno, na paleta), título curto, uma frase de contexto, ação primária. Alinhado ao centro do espaço, nunca gigante.

### Erro
- Diga o que aconteceu, o que o usuário pode fazer e ofereça a ação (Tentar de novo, Voltar, Contatar suporte). Código de erro em `text-subtle` mono para suporte.
- Erro parcial não derruba a tela inteira: isole por seção/widget.
- Página 404/500 com navegação de volta e busca, no mesmo layout do produto.

### Conteúdo extremo
- Teste com nome de 80 caracteres, valor de 12 dígitos, lista de 1 e de 10 000, texto sem espaços, RTL se o produto suportar.

## 12. Navegação

- **Tabs**: 2–7 itens do mesmo nível; ativo com indicador de 2 px no acento e texto `text`; inativo `text-muted`. Não use tabs para navegação entre páginas diferentes; use links.
- **Breadcrumb**: só a partir de 3 níveis; último item sem link.
- **Paginação**: mostrar total, página atual, anterior/próximo e alguns números; permitir escolher itens por página em tabelas.
- **Menu de contexto / dropdown**: itens 36–40 de altura, ícone 16 + texto 14, separadores entre grupos, ação destrutiva no final em `danger-text`.
- **Command palette (⌘K)**: para apps com muitas rotas; busca com resultados agrupados e atalhos visíveis.

## 13. Cards

- Card é agrupamento, não decoração. Se tudo é card, nada é.
- Padding 16–24, raio lg, borda `border` **ou** sombra sm (uma lógica). Título 16/600, corpo 14, metadados 13 `text-muted`.
- Nunca card dentro de card. Card clicável inteiro: torne o título o link e estenda a área com pseudo-elemento; mantenha foco visível no card.
- Grid de cards: `repeat(auto-fill, minmax(280px, 1fr))`, gap 16–24, alturas iguais por linha (`grid` cuida).
