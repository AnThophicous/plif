# Portão de segurança de release

Devolve `PASS`, `CONDITIONAL PASS` ou `BLOCKED`, sempre com evidência. O subconjunto verificável por máquina roda conforme as capacidades disponíveis; o restante é checklist explícito com dono nomeado para cada evidência.

**Build verde não é portão aprovado.** O build responde "compila e os testes passam"; o portão responde "isto pode ir para produção sem risco conhecido não aceito".

## Checklist

```text
[ ] nenhum segredo em fonte, configuração, logs, saída de build ou artefato final
[ ] sem configuração de depuração, credencial de teste, flag insegura ou arquivo indevido
[ ] dependências, lockfiles, scripts de ciclo de vida e procedência revisados
[ ] permissões de CI/CD e credenciais de publicação no menor privilégio
[ ] conteúdo, metadados, assinatura e reprodutibilidade do artefato inspecionados
[ ] testes de segurança e de regressão relevantes executados de verdade
[ ] configuração, headers, cookies, rede e permissões de runtime endurecidos
[ ] monitoramento, alerta, rollback e sinais de incidente presentes
[ ] invariantes de segurança preservadas no release (registro do SecurityIR reexecutado)
[ ] riscos abertos com dono, aceite, validade e controle compensatório
```

## Quando bloquear

Bloqueie diante de: risco crítico ou alto confirmado no release · segredo exposto · integridade de artefato ausente · controle crítico do escopo não resolvido.

A exceção é única e precisa ser explícita: um responsável autorizado aceita o risco, com prazo de validade e controle compensatório declarados. Aceite sem prazo é risco esquecido.

## Registro

Para cada item, guarde o que foi verificado, como, com qual ferramenta e versão, e o resultado. Item não verificado entra como não avaliado com o motivo — nunca como aprovado por omissão.
