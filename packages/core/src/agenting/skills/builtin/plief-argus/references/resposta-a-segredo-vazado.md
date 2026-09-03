# Resposta a segredo vazado em código ou histórico

Premissa: **qualquer segredo que chegou a um commit está comprometido**, mesmo em repositório privado, mesmo que "ninguém viu". Forks, clones, caches de CI, integrações e o próprio provedor do Git guardam cópias. Reescrever o histórico **não** substitui a rotação.

## Ordem de execução

1. **Identificar** — tipo do segredo (chave de API, senha de banco, token OAuth, chave privada, webhook secret), sistema que ele acessa, escopo/permissões, ambientes afetados, quando entrou no histórico (`git log -S '<prefixo>' --all`) e por quanto tempo ficou exposto. Mascare ao registrar (`AKIA…7Q`).

2. **Avisar** — o responsável pelo sistema e, se o segredo for de produção ou de terceiros (cliente, parceiro), o responsável por segurança/incidentes. Não espere terminar o procedimento.

3. **Rotacionar** — gere novo segredo **antes** de revogar o antigo, quando o serviço permite ambos ativos, para evitar indisponibilidade:
   1. criar novo segredo com escopo mínimo;
   2. atualizar no cofre/variáveis de todos os ambientes e serviços consumidores;
   3. validar que a aplicação funciona com o novo;
   4. **revogar o antigo**;
   5. confirmar que chamadas com o antigo falham.

4. **Investigar uso indevido** — logs de acesso do serviço (CloudTrail, audit logs do provedor, logs de API) desde a data do commit: chamadas de IPs/regiões estranhos, ações fora do padrão, criação de recursos, novos usuários/chaves. Registre o resultado, inclusive "nenhum indício encontrado" com o período coberto.

5. **Remover do código atual** — substituir por leitura de variável de ambiente/cofre; adicionar ao `.gitignore` se for arquivo; garantir que `.env.example` só tem placeholders.

6. **Limpar o histórico** (opcional, e só depois da rotação) — `git filter-repo` (preferido) ou BFG; force-push coordenado com o time (todos precisam reclonar); invalidar caches do provedor (GitHub: solicitar remoção de referências via suporte, pois commits órfãos continuam acessíveis por hash). Em repositórios com muitos forks, considere que a limpeza é parcial.

7. **Prevenir** —
   - pre-commit hook com gitleaks/trufflehog;
   - secret scanning no provedor (GitHub Advanced Security, GitLab Secret Detection) com push protection;
   - scanner no CI bloqueando merge;
   - revisar por que o segredo estava em código (falta de cofre? de `.env.example`? de documentação?) e corrigir a causa.

8. **Registrar** — no relatório: tipo (mascarado), sistema, janela de exposição, data/hora da rotação, resultado da investigação, ações preventivas, risco residual.

## Casos específicos

| Segredo | Cuidados adicionais |
|---|---|
| Chave AWS/GCP/Azure | verificar recursos criados (instâncias de mineração, usuários IAM novos, buckets públicos); revisar billing; rotacionar também chaves criadas pela chave vazada |
| Senha de banco | rotacionar usuário; revisar consultas/logins no período; se dados foram lidos, avaliar obrigação de notificação (LGPD art. 48) |
| Token OAuth/refresh | revogar sessões emitidas; invalidar refresh tokens; revisar consentimentos |
| Chave privada (TLS, SSH, JWT, assinatura) | tudo assinado/cifrado com ela é suspeito; emitir nova; revogar certificado; JWTs antigos continuam válidos até `exp` — considere lista de revogação temporária |
| Webhook secret | atacante pode forjar eventos; rotacionar e revisar eventos processados no período |
| Chave de serviço de e-mail/SMS | verificar envios não autorizados (phishing usando seu domínio); revisar reputação |
| Token de CI (GitHub PAT, npm token) | pode ter publicado pacotes ou alterado workflows; revisar histórico de publicação e de commits |
| Credenciais de terceiros/clientes | notificar o terceiro imediatamente; ele rotaciona |

## O que não fazer

- Não "só apagar do último commit" e seguir em frente.
- Não testar se o segredo ainda funciona usando-o (isso é uso da credencial); confirme pela interface do provedor.
- Não colar o segredo em issue, chat, ticket ou no relatório para "documentar".
- Não reescrever histórico antes da rotação.
- Não adiar a rotação por medo de indisponibilidade: planeje a janela, mas faça.
