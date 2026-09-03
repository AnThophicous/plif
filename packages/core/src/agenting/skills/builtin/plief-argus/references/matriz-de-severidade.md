# Matriz de severidade

Severidade é uma função de **impacto** × **facilidade de abuso** × **pré-requisitos**. Não é a categoria do scanner, não é a quantidade de ocorrências, não é a "fama" da vulnerabilidade.

## 1. Impacto

| Nível | Confidencialidade | Integridade | Disponibilidade |
|---|---|---|---|
| **Severo** | leitura de dados sensíveis de todos os usuários/tenants; segredos de infraestrutura; PII em massa | escrita arbitrária em dados de qualquer usuário; execução de código; escalada para admin/root | indisponibilidade total ou perda de dados |
| **Alto** | dados sensíveis de um tenant ou de muitos usuários; segredo de aplicação | alteração de dados de outros usuários; bypass de pagamento/fraude | indisponibilidade de função crítica |
| **Moderado** | dados não sensíveis de outros usuários; enumeração; informação interna (versões, caminhos) | alteração limitada dos próprios dados de forma indevida; spam | degradação perceptível |
| **Baixo** | informação pública ou de valor mínimo | efeito cosmético | efeito desprezível |

## 2. Facilidade de abuso

| Nível | Descrição |
|---|---|
| **Trivial** | requisição direta, URL, ferramenta pública; sem conhecimento especial |
| **Baixa** | exige entender a aplicação ou encadear 2 passos simples |
| **Média** | exige condição de corrida, timing, conhecimento interno ou várias etapas |
| **Alta** | exige condições raras, força bruta impraticável ou acesso físico |

## 3. Pré-requisitos

| Nível | Descrição |
|---|---|
| **Nenhum** | anônimo pela internet |
| **Conta comum** | qualquer usuário autenticado (auto-cadastro) |
| **Conta privilegiada ou interação da vítima** | admin, operador, ou a vítima precisa clicar/abrir algo |
| **Acesso interno** | rede interna, máquina do desenvolvedor, pipeline |

## 4. Combinação

Comece pelo impacto e ajuste:

| Impacto | Facilidade trivial/baixa + pré-req. nenhum/conta comum | Facilidade média ou pré-req. privilegiado/vítima | Facilidade alta ou acesso interno |
|---|---|---|---|
| Severo | **Crítica** | **Alta** | **Média** |
| Alto | **Alta** | **Média** | **Média** |
| Moderado | **Média** | **Baixa** | **Baixa** |
| Baixo | **Baixa** | **Informativa** | **Informativa** |

Ajustes:
- Dado regulado (saúde, financeiro, menores) ou obrigação legal (LGPD, PCI): pode subir um nível.
- Controle compensatório efetivo verificado (WAF configurado para o caso, rate limit, segmentação): pode descer um nível, registrando o controle.
- Código inalcançável ou funcionalidade desativada em produção: Informativa, com recomendação de remover o código.

## 5. Definições

| Severidade | Significado | Prazo sugerido de correção |
|---|---|---|
| **Crítica** | exploração fácil com impacto severo; provável exploração ativa | imediato (horas); considerar mitigação de emergência |
| **Alta** | impacto severo/alto com alguma barreira; ou impacto alto fácil | até 7 dias |
| **Média** | impacto moderado, ou alto com barreiras relevantes | até 30 dias |
| **Baixa** | impacto baixo, defesa em profundidade | até 90 dias ou próximo ciclo |
| **Informativa** | sem risco direto; melhoria, dívida técnica, higiene | sem prazo; registrar |

## 6. Mapeamento aproximado para CVSS

| Severidade | CVSS v3.1 / v4.0 base |
|---|---|
| Crítica | 9,0–10,0 |
| Alta | 7,0–8,9 |
| Média | 4,0–6,9 |
| Baixa | 0,1–3,9 |
| Informativa | 0 / N/A |

Use o CVSS como apoio, não como decisão final: o vetor não conhece o contexto de negócio do sistema.

## 7. Erros comuns ao classificar

- Copiar a severidade do scanner sem verificar alcançabilidade.
- Contar ocorrências como severidade (10 XSS refletidos em páginas internas não valem uma Crítica).
- Classificar "falta de header X" como Alta sem demonstrar impacto.
- Subestimar falhas de autorização (IDOR) porque "parece simples".
- Superestimar DoS teórico sem prova de custo assimétrico.
- Ignorar que segredo em histórico do Git continua válido até ser rotacionado.
