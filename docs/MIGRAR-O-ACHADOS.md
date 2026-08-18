# Trocar o servidor do achados e perdidos

Este é o roteiro do dia em que a escola deixa de ter dois servidores. Leia
inteiro antes de começar: a ordem dos passos importa, e um deles é fácil de
esquecer.

---

## Subir a 1.4.0 não desliga o servidor antigo

**O serviço .NET da porta 5080 continua exatamente como está.** A atualização do
Sistema-Gestão não encosta nele: não para o serviço, não apaga o
`achadosperdidos.db`, não mexe na pasta `C:\AchadosPerdidos`. São dois programas
diferentes, em duas portas diferentes.

Isso é de propósito. Depois de atualizar, a escola fica assim:

```
   Tablet da portaria  ──▶  :5080   servidor antigo (.NET)   ← ainda no ar
   PCs da secretaria   ──▶  :8080   Sistema-Gestão 1.4.0     ← com a aba Achados vazia
```

Os dois rodam ao mesmo tempo, sem brigar. Você vira a chave quando quiser, e
consegue testar tudo antes de desligar coisa nenhuma.

O tablet só passa a falar com o servidor novo quando alguém **instalar um APK
novo** nele. Enquanto o aparelho tiver o APK antigo, ele continua entregando na
porta 5080 — não tem virada automática nem risco de o tablet ficar sem servidor
no meio do caminho.

---

## O que pode ser migrado

Tudo o que está no servidor antigo:

| | Vai junto? |
|---|---|
| Categorias, com emoji | sim — casadas por nome, sem duplicar as que já existem |
| Itens, com data de cadastro e de entrega | sim |
| Situação (esperando, entregue, encerrado) | sim |
| Fotos | sim, copiadas para `dados\fotos` |
| Origem (qual tablet cadastrou) | sim — é o que evita item repetido depois |

O importador abre o banco antigo em **somente leitura**. Ele não altera nem
apaga nada de lá, então dá para rodar com o servidor .NET ligado, e dá para
rodar de novo quantas vezes precisar.

---

## O roteiro

### 1. Atualize o Sistema-Gestão

Dois cliques no `Atualizar.bat`. Ele faz backup do banco, baixa a versão nova,
confere a coerência e roda o teste de migração antes de liberar. Se qualquer
etapa falhar, ele para e o banco não é tocado.

Abra o `Gestao.bat` e confira que a aba **Achados** apareceu, vazia.

### 2. Pegue a chave do tablet

No sistema, **Ajustes → Tablet da portaria → Ver a chave**. Copie e guarde.
Você vai precisar dela no passo 4.

### 3. Traga os dados do servidor antigo

No Prompt de Comando, dentro da pasta do sistema:

```
npm run importar-achados -- "C:\AchadosPerdidos\achadosperdidos.db"
```

Se a pasta das fotos não estiver em `wwwroot\fotos` ao lado do banco, aponte
ela também:

```
npm run importar-achados -- "C:\AchadosPerdidos\achadosperdidos.db" "D:\Fotos"
```

Ele conta quantas categorias, itens e fotos entraram. Abra a aba Achados e
confira se está tudo lá, com as fotos.

### 4. Gere o APK novo e instale no tablet

No `Android/local.properties` do projeto do aplicativo:

```properties
achados.baseUrl=http://192.168.15.61:8080/
achados.apiKey=<a chave do passo 2>
```

Troque `192.168.15.61` pelo IP do PC servidor, se for outro — é o mesmo
endereço que a secretaria digita no navegador, só que com `:8080` no lugar de
`:5080`.

Gere o APK, instale no tablet e abra o aplicativo. Mande sincronizar à mão
(**Sincronizar agora**, no painel do gestor) e confira que os itens aparecem na
aba Achados do sistema.

### 5. Rode o importador uma última vez

**Este é o passo que se esquece.** Entre o passo 3 e o passo 4, o tablet ainda
estava entregando na porta 5080 — tudo que a portaria cadastrou nesse intervalo
foi para o banco antigo e não veio junto.

Rode o mesmo comando do passo 3 outra vez. O importador não duplica nada: ele
casa item por tablet + id local, então só entra o que ficou para trás.

### 6. Só agora desligue o servidor antigo

Com o tablet já sincronizando no 8080 e os dados conferidos:

```
sc stop AchadosPerdidosApi
sc config AchadosPerdidosApi start= disabled
```

Não apague a pasta `C:\AchadosPerdidos` ainda. Deixe ela quieta por um mês —
custa nada e é a sua volta atrás.

---

## Se der errado

Enquanto você não fizer o passo 6, **voltar atrás é instalar o APK antigo no
tablet**. O servidor .NET continua no ar com todos os dados dele, e a escola
volta a funcionar como antes. Nada foi apagado de lá em nenhum momento.

Do lado do Sistema-Gestão, o `Atualizar.bat` guardou uma cópia do banco em
`OneDrive\Backups Gestao` antes de qualquer coisa.

---

## Depois da virada

O `Backup.bat` passa a levar as fotos do achados e perdidos junto com o banco,
numa pasta `fotos` dentro do destino. Não existe mais um segundo backup para
lembrar de fazer.

E a porta 5080 fica livre.
