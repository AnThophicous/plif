# Matriz por tipo de projeto — roteamento da avaliação

Auxílio de roteamento, **não** substituto de percorrer o caminho real do código. Carregue depois de identificar o tipo de projeto; o resultado alimenta a classificação do SecurityIR.

## Classificação

| Evidência encontrada | Superfície provável | Primeiras verificações |
|---|---|---|
| `index.html`, rotas React/Vue/Svelte, bundle de navegador | Site / frontend | XSS, sinks de DOM, estado de autenticação, CSP, armazenamento local, CORS, cadeia de suprimentos |
| rotas HTTP, controllers, OpenAPI, GraphQL, RPC | API / backend | autorização e BOLA, validação, injeção, SSRF, limites de taxa, erros, segredos |
| `bin` no `package.json`, ponto de entrada de CLI, E/S de terminal | CLI / pacote | fronteiras de shell e de caminho, subprocessos, permissões de configuração, logs, fluxo de atualização |
| projeto Android/iOS, componentes exportados, deep links | Mobile | armazenamento local, tokens, TLS, deep links, superfícies exportadas, backups |
| Electron, Tauri, executável nativo | Desktop | IPC, sistema de arquivos, handlers de protocolo, atualizador e assinaturas, fronteiras de privilégio |
| Dockerfile, Helm, Terraform, workflows de CI | Infraestrutura | menor privilégio, segredos, exposição de rede, procedência, permissões de artefato |
| consumidores de fila, cron, workers, ETL | Worker / serviço de dados | autenticação de mensagem, desserialização, replay, isolamento de tenant, minimização de dados |
| metadados de biblioteca e workflow de publicação | Cadeia de suprimentos | lockfile, scripts de ciclo de vida, conteúdo do tarball, procedência, escopo do token |
| agente que chama ferramentas, roteador de prompt, memória, provedor de modelo | Sistema de IA | injeção de prompt, autorização de ferramenta, envenenamento de contexto, vazamento de segredo, aprovações, autonomia |

## Modos de teste seguro

**Somente estático.** Use quando não há autorização ou o alvo é desconhecido. Inspecione código, configuração, lockfiles, testes, histórico e artefatos de build. Não envie requisição de rede ao alvo.

**Verificação local.** `localhost`, contêineres descartáveis, identidades falsas, registros sintéticos e fixtures. Uma hipótese por vez. Cargas inofensivas e reversíveis.

**Avaliação em staging.** Exige hosts nomeados, contas e dados de teste, limites de taxa, caminhos permitidos, ações proibidas e condição de parada. Sem escrita destrutiva, força bruta, varredura ampla, exportação de dados, persistência ou interferência em usuários reais.

**Validação em produção.** O padrão é passivo, ou canário explicitamente aprovado. Não sonde produção só porque ela está acessível. Pare imediatamente diante de dado inesperado, impacto, anomalia de autenticação, aumento de erros ou ambiguidade de escopo.

## Barra de qualidade do achado

Um achado útil conecta a cadeia inteira:

```text
entrada controlada pelo atacante
  -> fronteira vulnerável
  -> sink alcançável
  -> impacto concreto
  -> menor prova segura
  -> remediação testada
```

Faltando um elo, o item é hipótese não verificada — não vulnerabilidade confirmada. Ver [`caminhos-de-ataque.md`](caminhos-de-ataque.md), que transforma essa regra em classificação mecânica.

## Roteamento para sistemas de IA

Mapeie a fronteira entre conteúdo do usuário, conteúdo recuperado, memória de conversa, instruções do modelo, ferramentas, credenciais e sistemas externos. Detalhe em [`seguranca-de-ia.md`](seguranca-de-ia.md).

Use fixtures locais e respostas de ferramenta sintéticas, a menos que o teste ativo esteja explicitamente autorizado para um ambiente nomeado.
