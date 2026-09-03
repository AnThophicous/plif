# Analisador de identidade — quem pode fazer o quê

A cadeia de autorização é modelada como nós e arestas dentro do SecurityIR, não como prosa à parte:

```text
Principal -> Credential/Session -> Role/Policy -> Resource Scope -> Action -> Audit/Detection
```

## O que procurar percorrendo as cadeias

- **Aresta de propriedade ausente** — o objeto é buscado por identificador sem vínculo com o dono. É a falha de autorização em nível de objeto (IDOR), e aparece no grafo como um `accesses` sem `requires` correspondente.
- **Quebra de isolamento entre tenants** — o escopo salta um nó de fronteira de tenant.
- **Autenticação sem autorização adiante** — o `Principal` é identificado, mas nenhum controle a jusante verifica permissão.
- **Transições de privilégio** — elevações por `delegates_to` ou `trusts`.
- **Delegado confuso** — principal de serviço ou de agente agindo sobre dados derivados do usuário com escopo mais largo que o dele.
- **Escopo largo demais** — `*` ou escopo de tenant onde já existe precedente de escopo por entidade. Marca o sinal `new_privilege_overbroad` no SecDiff.
- **Ação privilegiada sem aresta de auditoria** — a ação acontece e não deixa rastro reconstruível.
- **Autorização obsoleta** — credencial ou sessão ainda referenciada depois que o contrato de escopo foi removido a montante.

## Regra de leitura

Aresta faltando é **desconhecido de autorização**, não vulnerabilidade automática. Antes de classificar como achado, correlacione com um caminho alcançável: sem entrada que chegue até ali, o que existe é dívida de modelagem, não risco explorável. O relatório precisa distinguir os dois — tratar todo `UNKNOWN` como falha destrói a credibilidade do resto do documento.
