# Contrato com o tablet — não quebre isto

O tablet Android (`com.escola.achadosperdidos`) fala com o servidor por estas
rotas. O código do app foi escrito contra a API .NET original; ao portar para o
Node, **os nomes de campo, os tipos e os códigos HTTP abaixo continuam iguais**.
Quem mexer no `src/achados.js` precisa reler esta página antes.

Fonte da verdade no lado do tablet:
`Android/app/src/main/java/com/escola/achadosperdidos/data/network/`
(`ApiService.kt`, `SyncRepository.kt`, `dto/`).

---

## Regras que valem para tudo

| Assunto | Regra |
|---|---|
| Formato | JSON `camelCase`. Gson casa por nome exato do campo. |
| Autenticação | Cabeçalho `X-Api-Key`. O site usa cookie de sessão; as rotas do tablet aceitam **os dois**. |
| `status` | Número, nunca texto: `0 = Encontrado`, `1 = Devolvido`, `2 = Expirado`. |
| Datas enviadas pelo tablet | `yyyy-MM-dd'T'HH:mm:ss` em UTC, sem fuso no fim. |
| Datas devolvidas pelo servidor | ISO-8601. O tablet corta a fração de segundo e o `Z` (`parseDataServidor`), então tanto faz ter ou não. |
| Campo ausente | Gson entrega `null`. Campo a mais no JSON é ignorado — dá para acrescentar, nunca renomear. |

---

## `POST /api/sync/itens`

Envio em lote do tablet offline. Corpo: **array** de item (lotes de 5).

```jsonc
[{
  "descricao": "Lancheira azul",
  "localEncontrado": "Pátio",         // pode ser null
  "categoriaServidorId": 3,           // pode ser null
  "categoriaIdLocalTablet": "uuid",   // pode ser null
  "status": 0,
  "dataCadastro": "2026-08-18T13:04:00",
  "dataDevolucao": null,
  "tabletId": "tablet-01",
  "idLocalTablet": "uuid",
  "fotoBase64": "…",                  // sem quebra de linha, pode ser null
  "nomeArquivoFoto": "foto.jpg"       // pode ser null
}]
```

Resposta `200`:

```json
{ "recebidos": 5, "criados": 4, "atualizados": 1, "erros": [] }
```

Pontos que o `SyncRepository` depende:

- A identidade do item é o par **`tabletId` + `idLocalTablet`**. Reenviar o mesmo
  par tem de virar *atualizado*, nunca um segundo item — o tablet reenvia o lote
  inteiro quando a Wi-Fi cai no meio.
- Reenvio só atualiza `status` e `dataDevolucao`. Descrição, foto e local ficam
  como entraram; senão uma sync tardia sobrescreveria a correção feita no site.
- `erros` não vazio faz o tablet **manter o lote inteiro pendente** e tentar de
  novo. Só coloque aí o que realmente não entrou.
- Item sem categoria resolvível entra em `erros` com o `idLocalTablet` na frente,
  no formato `"<idLocalTablet>: <motivo>"`.

## `GET /api/sync/categorias?desde=<ISO-8601>`

`desde` é opcional; sem ele, devolve todas. Resposta: array de

```json
{ "id": 3, "nome": "Casacos", "ativa": true, "dataCriacao": "2026-05-24T18:00:57", "emoji": "🧥" }
```

`ativa` é booleano de verdade (`true`/`false`), não `0`/`1` — o Gson do tablet
desserializa em `Boolean`. `emoji` o app atual ignora, e isso está certo.

## `GET /api/categorias?somenteAtivas=true`

Mesmo objeto de cima. Usado no merge por nome, que compara
`nome.trim().lowercase()` — a comparação de nome no servidor também é sem
diferenciar maiúscula.

## `POST /api/categorias`

Corpo do tablet: `{ "nome": "...", "idLocalTablet": "uuid" }` (o app **não manda
`emoji`**). Resposta `201` com o objeto de categoria completo.
Nome repetido devolve `409`.

## `GET /api/itens?categoriaId=&status=`

Array de:

```json
{
  "id": 12, "descricao": "…", "localEncontrado": "…",
  "categoriaId": 3, "categoriaNome": "Casacos",
  "status": 0,
  "dataCadastro": "2026-08-18T13:04:00", "dataDevolucao": null,
  "urlFoto": "http://192.168.15.61:8080/fotos/ab12.jpg",
  "tabletId": "tablet-01", "idLocalTablet": "uuid"
}
```

`urlFoto` tem de ser **absoluta**: o tablet passa ela inteira no `@Url` do
Retrofit, ignorando a baseUrl. Caminho relativo quebra o download da foto.

## `PATCH /api/itens/{id}/status`

Corpo `{ "status": 1 }`. Resposta **`204` sem corpo** — o Retrofit espera
`Response<Unit>`.

## `DELETE /api/itens/{id}`

Resposta `204`.

## `GET /fotos/<arquivo>`

Arquivo estático, com `X-Api-Key` aceito mas não exigido.

---

## O que mudou de fato na virada para o Node

1. **Porta.** Era `5080` no .NET; agora é a mesma `8080` do sistema da
   secretaria. Ajuste `achados.baseUrl` no `local.properties` do Android.
2. **Chave.** Era o `ApiKey` do `appsettings.json`; agora o servidor gera uma na
   primeira partida e mostra em *Ajustes → Tablet*. Copie para
   `achados.apiKey` no `local.properties`.
3. **Banco.** Era `achadosperdidos.db` separado; agora são as tabelas
   `ap_categorias` e `ap_itens` dentro do `gestao.db`, que já entra no
   `Backup.bat`.

Nada além disso. Os DTOs, o `SyncRepository` e o `ApiService` do Android
continuam como estavam.
