# Checklist de controles

Alinhado a OWASP ASVS 4.x/5.0 (nível 2) e OWASP Top 10 2021/2025. Para cada item registre: **Presente**, **Ausente/inadequado** (→ achado) ou **Não avaliado** (com motivo). Referências ao código são obrigatórias para "Presente".

## 1. Autenticação

- [ ] Senhas com hash lento e salgado (Argon2id, scrypt, bcrypt custo ≥ 10); nunca MD5/SHA-1/SHA-256 puro; nunca reversível.
- [ ] Política de senha: mínimo 8–12 caracteres, verificação contra listas de senhas vazadas, sem regras de composição arbitrárias, permite colar e gerenciadores de senha.
- [ ] Proteção contra força bruta e credential stuffing: rate limit por conta **e** por IP, backoff, bloqueio temporário ou desafio; resposta em tempo constante para usuário inexistente vs. senha errada.
- [ ] Mensagens de erro de login não revelam se o usuário existe.
- [ ] MFA disponível (TOTP/WebAuthn); códigos de recuperação com hash; MFA não pode ser contornado por fluxo alternativo (API, mobile, "lembrar dispositivo" sem limite).
- [ ] Recuperação de senha: token aleatório ≥ 128 bits, uso único, expira (≤ 1 h), invalida sessões ao concluir, não revela existência da conta.
- [ ] Sem credenciais padrão, contas de teste ou backdoors de desenvolvimento em código de produção.
- [ ] Login social/OAuth/OIDC: `state` e `nonce` validados, `redirect_uri` em lista fixa, tokens validados (assinatura, `iss`, `aud`, `exp`), PKCE em clientes públicos.

## 2. Sessão e tokens

- [ ] ID de sessão aleatório (≥ 128 bits, CSPRNG), regenerado no login e na elevação de privilégio.
- [ ] Cookie de sessão: `HttpOnly`, `Secure`, `SameSite=Lax` ou `Strict`, `Path` restrito, prefixo `__Host-` quando possível; sem dados sensíveis no valor.
- [ ] Expiração absoluta e por inatividade; logout invalida no servidor (não só apaga o cookie).
- [ ] JWT: algoritmo fixo no servidor (rejeitar `none` e confusão RS/HS), chave ≥ 256 bits, `exp` curto (≤ 15 min para access), refresh token rotativo com detecção de reuso, validação de `iss`/`aud`, sem dados sensíveis no payload, revogação possível quando necessário.
- [ ] Tokens de API: armazenados como hash, escopo mínimo, expiração, revogação, exibidos uma vez.
- [ ] Sessões listáveis e revogáveis pelo usuário; troca de senha invalida outras sessões.

## 3. Autorização

- [ ] Toda operação verifica autorização **no servidor**, por recurso e por ação, usando a identidade da sessão — nunca IDs, papéis ou flags vindos do cliente.
- [ ] Sem IDOR: acesso a `/recurso/:id` confirma que o recurso pertence ao usuário/tenant; IDs previsíveis não são a única barreira.
- [ ] Isolamento de tenant em toda consulta (filtro obrigatório por `tenant_id`, idealmente em camada central: scope padrão, RLS no banco, middleware).
- [ ] Deny by default: rotas sem anotação explícita são negadas; verificação centralizada (middleware/policy), não espalhada por handler.
- [ ] Escalada vertical impossível: alterar próprio `role`, aceitar convites de admin, endpoints administrativos sem verificação.
- [ ] Ações em massa, exportações e relatórios respeitam as mesmas regras que a visualização individual.
- [ ] Autorização também em GraphQL resolvers, WebSocket, jobs, webhooks e endpoints "internos".
- [ ] Mudanças de permissão têm efeito imediato (sem cache de autorização sem invalidação).

## 4. Validação de entrada e codificação de saída

- [ ] Validação no servidor de tipo, tamanho, formato, faixa e lista de valores permitidos para toda entrada (corpo, query, header, cookie, path, upload, mensagens de fila).
- [ ] Esquemas de validação (Zod, Pydantic, Joi, JSON Schema) com `strict`/`additionalProperties: false`; sem mass assignment (`Object.assign(user, req.body)`).
- [ ] Injeção SQL/NoSQL: consultas parametrizadas ou ORM; nunca concatenação; ORMs com `raw`/`literal` revisados; operadores NoSQL (`$where`, `$gt`) bloqueados em entrada.
- [ ] Injeção de comando: sem `shell=True`/`exec` com entrada; use APIs com argumentos separados e lista de permitidos.
- [ ] XSS: codificação contextual na saída (HTML, atributo, JS, URL, CSS); templates com escape automático; `dangerouslySetInnerHTML`/`v-html`/`innerHTML` só com sanitização (DOMPurify) e justificativa; CSP como defesa em profundidade.
- [ ] Path traversal: caminhos canonizados e confinados a diretório base; nomes de arquivo gerados pelo servidor; sem `..`.
- [ ] SSRF: URLs fornecidas pelo usuário validadas contra lista de permitidos de host/esquema/porta, resolução DNS verificada, bloqueio de IPs privados/link-local/metadata (169.254.169.254), sem seguir redirecionamentos sem revalidar.
- [ ] Desserialização: nunca `pickle`/`unserialize`/`ObjectInputStream`/`yaml.load` com entrada não confiável; use formatos de dados (JSON) com esquema.
- [ ] XML: entidades externas desativadas (XXE); parsers em modo seguro.
- [ ] Template injection: entrada nunca vira template; só dados.
- [ ] Header injection e CRLF em redirecionamentos e headers construídos com entrada.
- [ ] Open redirect: destinos em lista fixa ou relativos validados.
- [ ] Limites de tamanho de corpo, profundidade de JSON, quantidade de campos, tamanho de upload; timeouts.
- [ ] Regex com entrada: sem padrões vulneráveis a ReDoS; timeouts ou engines lineares (RE2).

## 5. Upload de arquivos

- [ ] Tipo validado pelo conteúdo (magic bytes), não só pela extensão ou `Content-Type`; lista de permitidos.
- [ ] Tamanho máximo; imagem reprocessada (remove metadados e payloads); SVG sanitizado ou servido como download.
- [ ] Armazenado fora do webroot ou em bucket, com nome gerado pelo servidor; servido com `Content-Disposition` adequado e `X-Content-Type-Options: nosniff`; domínio separado para conteúdo de usuário.
- [ ] Scan antimalware quando o arquivo é redistribuído.
- [ ] Arquivos compactados: limite de tamanho descompactado e de entradas (zip bomb), sem caminhos absolutos ou `..` (zip slip).

## 6. CSRF e proteção do navegador

- [ ] Operações que mudam estado usam token CSRF (synchronizer ou double-submit assinado) **ou** `SameSite` + verificação de `Origin`/`Sec-Fetch-Site`; nunca em GET.
- [ ] CORS: `Access-Control-Allow-Origin` em lista fixa (nunca reflete a origem nem `*` com credenciais); métodos e headers mínimos; `Vary: Origin`.
- [ ] Headers: `Content-Security-Policy` (sem `unsafe-inline`/`unsafe-eval` em script, com nonce/hash), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- [ ] Clickjacking: `frame-ancestors 'none'` ou lista.
- [ ] Sem informações sensíveis em URL (tokens, PII) — vazam por Referer, logs e histórico.

## 7. Criptografia e segredos

- [ ] Sem algoritmos quebrados (MD5, SHA-1 para segurança, DES, RC4, ECB, RSA PKCS#1 v1.5 para cifragem).
- [ ] Cifragem autenticada (AES-GCM, ChaCha20-Poly1305) com nonce único; chaves ≥ 128 bits; bibliotecas de alto nível (libsodium, `cryptography`, Web Crypto) em vez de primitivas manuais.
- [ ] Aleatoriedade de segurança via CSPRNG (`crypto.randomBytes`, `secrets`, `SecureRandom`), nunca `Math.random`/`random`.
- [ ] Comparação de segredos em tempo constante.
- [ ] TLS 1.2+ em todas as conexões, inclusive internas e para bancos/filas; verificação de certificado não desativada (`verify=False`, `rejectUnauthorized: false`, `InsecureSkipVerify`).
- [ ] Segredos fora do código e do repositório: variáveis de ambiente injetadas, cofre (Vault, AWS Secrets Manager, GCP Secret Manager, Doppler) ou arquivos não versionados; `.env` no `.gitignore`; `.env.example` sem valores reais.
- [ ] Histórico do Git sem segredos (scan com gitleaks/trufflehog); segredos já expostos considerados comprometidos → [`resposta-a-segredo-vazado.md`](resposta-a-segredo-vazado.md).
- [ ] Rotação possível sem downtime; segredos com escopo mínimo; um segredo por serviço/ambiente.
- [ ] Segredos não vão para logs, mensagens de erro, URLs, analytics, crash reports ou frontend (bundle).

## 8. Tratamento de erros, logs e PII

- [ ] Erros para o cliente são genéricos; stack traces, consultas SQL, caminhos e versões só em logs do servidor; modo debug desativado em produção.
- [ ] Logs de segurança: login (sucesso/falha), alteração de senha/MFA, mudança de permissão, acesso negado, ações administrativas, exportações — com identidade, IP, timestamp UTC, ID de correlação.
- [ ] Logs sem segredos, tokens, senhas, dados de cartão ou PII desnecessária; mascaramento centralizado.
- [ ] Log injection: entrada do usuário sanitizada antes de logar (quebras de linha, caracteres de controle).
- [ ] PII: inventário do que é coletado, base legal, minimização, retenção definida, exclusão possível (LGPD art. 18), criptografia em repouso para dados sensíveis, acesso auditado.
- [ ] Backups cifrados e testados; acesso restrito.

## 9. Dependências e supply chain

- [ ] Lockfile versionado e respeitado no CI (`npm ci`, `pip install -r` com hashes, `poetry.lock`, `go.sum`).
- [ ] Scanner de dependências ativo (Dependabot/Renovate + audit/Snyk/Trivy/OSV-Scanner); vulnerabilidades Altas/Críticas tratadas; sem dependências abandonadas em caminhos críticos.
- [ ] Sem instalação de pacotes de fontes não oficiais; escopo de pacotes privados protegido contra dependency confusion.
- [ ] Scripts de instalação (`postinstall`) revisados; `--ignore-scripts` em CI quando viável.
- [ ] Versões fixadas (SHA) em GitHub Actions de terceiros; permissões mínimas do `GITHUB_TOKEN`; sem `pull_request_target` com checkout de código do PR.
- [ ] Imagens base fixadas por digest, de fontes confiáveis, atualizadas; SBOM gerado quando exigido.

## 10. Configuração e infraestrutura

- [ ] Princípio do menor privilégio em usuários de banco, roles IAM, service accounts, tokens de CI.
- [ ] Containers: usuário não root, filesystem read-only quando possível, sem `--privileged`, capabilities mínimas, sem segredos em `ENV`/camadas, `.dockerignore` excluindo `.env`, `.git`, chaves.
- [ ] Portas administrativas (banco, Redis, painéis) não expostas publicamente; autenticação obrigatória.
- [ ] Buckets e storage sem acesso público por padrão; URLs assinadas com expiração curta.
- [ ] IaC (Terraform, CloudFormation, Kubernetes) escaneado (Checkov, tfsec, KICS, Trivy); sem `0.0.0.0/0` em portas sensíveis; criptografia em repouso ativada.
- [ ] Separação de ambientes; produção não usa credenciais de dev; feature flags de debug desativadas.

## 11. Rate limiting, abuso e disponibilidade

- [ ] Rate limit em login, cadastro, recuperação, envio de e-mail/SMS, APIs caras e endpoints públicos; por identidade e por IP; resposta 429 com `Retry-After`.
- [ ] Idempotência em operações de pagamento e criação (chave de idempotência).
- [ ] Limites de paginação, tamanho de resposta e complexidade de consulta (GraphQL depth/complexity).
- [ ] Timeouts em chamadas externas; circuit breaker onde relevante.
- [ ] Proteção contra enumeração de usuários e recursos (respostas uniformes, IDs não sequenciais onde importa).
- [ ] CAPTCHAs ou desafios em fluxos abusáveis por bots quando rate limit não basta.

## 12. Lógica de negócio

- [ ] Fluxos multi-etapa não podem pular etapas (pagamento antes de entrega, verificação antes de acesso).
- [ ] Valores calculados no servidor (preço, desconto, saldo); cliente nunca envia total.
- [ ] Condições de corrida em operações financeiras e de estoque (locks, transações, idempotência).
- [ ] Limites de negócio validados (quantidade negativa, cupom reutilizado, transferência para si mesmo).
- [ ] Funções administrativas exigem reautenticação ou MFA para ações sensíveis.

## 13. Testes de segurança

- [ ] Testes negativos para autorização (usuário A não acessa recurso de B; usuário comum não acessa admin).
- [ ] Testes para validação de entrada (payloads maliciosos rejeitados).
- [ ] Testes para invariantes críticos (total nunca negativo, tenant nunca vazio).
- [ ] SAST (Semgrep, CodeQL, Bandit, ESLint security) e secret scanning no CI, bloqueando merge em achados Altos/Críticos.
- [ ] DAST ou testes de integração de segurança em staging quando o produto justifica.
