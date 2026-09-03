# Checklist de hardening — configurações de referência

Valores seguros por padrão. Adapte ao contexto e registre desvios como decisão consciente.

## 1. Headers HTTP

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<aleatório>' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Frame-Options: DENY
Cache-Control: no-store            (respostas com dados sensíveis / autenticadas)
```

- CSP: comece em `Content-Security-Policy-Report-Only`, colete violações, depois aplique. Sem `unsafe-inline` em `script-src`; use nonce por requisição ou hashes. `unsafe-eval` só com justificativa documentada.
- Remova headers que revelam tecnologia: `Server`, `X-Powered-By`, `X-AspNet-Version`.
- HSTS `preload` só depois de garantir HTTPS em todos os subdomínios.

## 2. Cookies

```
Set-Cookie: __Host-session=<id>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600
```

- `__Host-` prefixo (exige `Secure`, `Path=/`, sem `Domain`).
- `SameSite=Strict` para cookies de sessão em apps sem navegação cross-site legítima; `Lax` quando há links externos entrando autenticados.
- Cookies de CSRF token (double-submit) sem `HttpOnly` mas com `Secure` e `SameSite`.
- Nenhum cookie com PII ou flags de autorização legíveis/alteráveis pelo cliente.

## 3. CORS

- `Access-Control-Allow-Origin`: origem exata de uma lista fixa; nunca refletir `Origin` recebido; nunca `*` com `Allow-Credentials: true`; nunca `null`.
- `Access-Control-Allow-Methods` e `-Headers` mínimos.
- `Vary: Origin` para cache correto.
- Pré-flight (`OPTIONS`) sem efeitos colaterais e sem exigir autenticação.
- Subdomínios com regex: âncore no fim (`^https://([a-z0-9-]+\.)?exemplo\.com$`), evitando `exemplo.com.atacante.com`.

## 4. TLS

- Mínimo TLS 1.2; preferir 1.3; desativar 1.0/1.1, SSLv3.
- Cifras AEAD (AES-GCM, ChaCha20-Poly1305) com ECDHE; sem RC4, 3DES, CBC antigo, export.
- Certificados de CA confiável, renovação automática (ACME), OCSP stapling.
- Conexões internas (app → banco, app → fila, serviço → serviço) também com TLS e verificação de certificado.
- Nunca `verify=False`, `rejectUnauthorized: false`, `InsecureSkipVerify: true`, `-k` em produção.

## 5. Docker e contêineres

```dockerfile
FROM node:22-alpine@sha256:<digest>          # imagem fixada por digest
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app                                     # não root
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
```

- `.dockerignore` com `.git`, `.env*`, `*.pem`, `*.key`, `node_modules`, `coverage`, docs.
- Multi-stage build: ferramentas de build não vão para a imagem final.
- Sem segredos em `ENV`, `ARG` ou camadas (ficam no histórico da imagem); use secrets de build (`--mount=type=secret`) e injeção em runtime.
- Runtime: `--read-only` + `tmpfs` para escrita, `--cap-drop=ALL` + `--cap-add` mínimo, `--security-opt=no-new-privileges`, sem `--privileged`, sem montar `/var/run/docker.sock`, limites de CPU/memória.
- Kubernetes: `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, NetworkPolicy padrão deny, secrets via CSI/external-secrets, sem `hostNetwork`/`hostPID`.
- Scan de imagem (Trivy, Grype) no CI, bloqueando Críticas.

## 6. CI/CD (GitHub Actions como exemplo)

```yaml
permissions:
  contents: read            # padrão mínimo no topo do workflow

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha-completo>   # fixado por SHA, não por tag
        with:
          persist-credentials: false
```

- `permissions` mínimas por workflow/job; `id-token: write` só onde há OIDC.
- Actions de terceiros fixadas por SHA completo; Dependabot/Renovate atualizando.
- Nunca `pull_request_target` com `checkout` do `head` do PR + execução de scripts do PR.
- Entradas de eventos (`github.event.issue.title`, `head_ref`) nunca interpoladas direto em `run:`; passe por `env:`.
- Segredos só em ambientes protegidos; `environment` com aprovação para deploy em produção; sem `echo $SECRET`.
- Artefatos e caches não contêm segredos; logs com mascaramento.
- Branch protection: revisão obrigatória, status checks (testes, SAST, SCA, secret scan), assinatura de commits quando exigido, sem force-push em `main`.
- Deploy por OIDC (sem chaves de longa duração); credenciais de cloud com escopo mínimo.
- Proveniência/SLSA e assinatura de artefatos (Sigstore/cosign) para software distribuído.

## 7. Dependências

- Lockfile sempre; instalação determinística (`npm ci`, `pip-sync`/hashes, `poetry install --sync`, `go mod verify`).
- Scanner de vulnerabilidades no CI, bloqueando Altas/Críticas em produção; janela de exceção documentada.
- Renovate/Dependabot com agrupamento e auto-merge só para patch com testes verdes.
- Registro privado com escopo reservado (`@empresa/*`) para evitar dependency confusion; `.npmrc` sem tokens versionados.
- `npm ci --ignore-scripts` quando viável; revisar `postinstall` de novas dependências.
- Remover dependências não usadas (`depcheck`, `pip-autoremove`); preferir bibliotecas mantidas.
- Em pacotes publicados: `npm publish --provenance`, 2FA no registro, `files` restrito no `package.json`.

## 8. Segredos

- Fonte única: cofre (Vault, AWS/GCP/Azure Secrets Manager, Doppler, 1Password Secrets Automation) ou variáveis injetadas pelo orquestrador.
- Um segredo por serviço por ambiente; escopo mínimo; expiração e rotação automatizadas onde a plataforma permite.
- `.env` no `.gitignore`; `.env.example` versionado só com nomes e valores fictícios óbvios (`CHANGE_ME`).
- Pre-commit com gitleaks/trufflehog; scan do histórico completo ao adotar.
- Segredos nunca no frontend: variáveis `NEXT_PUBLIC_*`/`VITE_*` são públicas por definição.
- Segredo exposto = comprometido: siga [`resposta-a-segredo-vazado.md`](resposta-a-segredo-vazado.md).

## 9. Banco de dados

- Usuário da aplicação sem `SUPERUSER`/`DROP`/`GRANT`; separar usuário de migração do de runtime.
- TLS obrigatório; sem acesso público (security group/VPC); sem porta padrão exposta na internet.
- Criptografia em repouso; backups cifrados, testados e com retenção definida.
- Row-Level Security para multi-tenant quando o banco suporta (PostgreSQL).
- Logs de consultas lentas sem parâmetros sensíveis; auditoria de acesso administrativo.
- Consultas parametrizadas; extensões perigosas desativadas.

## 10. Aplicação (framework)

- Modo debug/dev desativado em produção (`DEBUG=False`, `NODE_ENV=production`, `APP_ENV=production`).
- Chave de sessão/`SECRET_KEY` forte, por ambiente, fora do código.
- Limite de tamanho de corpo (`bodyParser` 100 kB–1 MB para JSON; uploads em rota própria).
- Proxy confiável configurado (`trust proxy`, `X-Forwarded-For` só do balanceador) para rate limit e logs corretos.
- Rotas de health/metrics sem dados sensíveis e, se necessário, protegidas por rede.
- Documentação de API (Swagger) desativada ou protegida em produção.
- Compressão desativada para respostas com segredos em conteúdo controlado pelo atacante (BREACH), ou mitigada.
