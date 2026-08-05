# Instalar no servidor da escola

Passo a passo do zero. Leva uns 10 minutos.

---

## Antes de começar

O servidor precisa de duas coisas instaladas:

| O quê | Já tem? | Onde baixar |
|---|---|---|
| **Node.js** (versão LTS) | você disse que sim | <https://nodejs.org> |
| **Git** | provavelmente não | <https://git-scm.com> |

O Git é o que permite baixar o sistema e, depois, atualizar com dois cliques.
Na instalação dele pode ir clicando em avançar sem mudar nada.

Também precisa de **internet no servidor** na primeira instalação, para baixar
o sistema e seus componentes. Depois disso ele roda sozinho na rede local.

---

## 1. Baixar o sistema

Aperte `Windows + R`, digite `cmd` e dê Enter. Cole isto e aperte Enter:

```
cd /d %USERPROFILE%
git clone https://github.com/gabrielrosas28/Sistema-Gestao.git Gestao
```

Isso cria a pasta `Gestao` dentro do seu usuário — fora do OneDrive, que é
onde ela precisa ficar.

> **Não baixe o ZIP do GitHub.** Funciona, mas aí o `Atualizar.bat` não tem
> como saber de onde buscar a versão nova, e toda atualização vira trabalho
> manual.

---

## 2. Instalar

Abra a pasta `Gestao` e dê **dois cliques em `Instalar.bat`**.

Ele vai:

1. Conferir o Node.js
2. Baixar os componentes
3. **Pedir a planilha dos alunos** — arraste o arquivo
   `Gerador de boletim - 2026.xlsx` para dentro da janela preta e aperte Enter.
   Se a planilha ainda não estiver no servidor, só aperte Enter: as 39 turmas e
   o calendário letivo entram do mesmo jeito, e os alunos ficam para depois
   (é só rodar `npm run importar` mais tarde).
4. Perguntar **nome, e-mail e senha** do primeiro acesso, que é o da coordenação

---

## 3. Ligar

Dois cliques em **`Gestao.bat`**.

A janela preta mostra os endereços, tipo:

```
Neste PC:      http://localhost:8080
Nos outros PCs: http://192.168.0.10:8080
```

**Deixe essa janela aberta.** Fechar ela derruba o sistema para todo mundo.

---

## 4. Liberar no firewall

Ainda no servidor, clique com o botão direito em **`Liberar na rede.bat`** e
escolha **Executar como administrador**.

Sem isso o sistema abre no próprio servidor mas **não abre nas outras
máquinas** — o Firewall do Windows bloqueia conexões de fora. É o motivo número
um de "não consigo acessar".

Ele libera só as redes privada e de domínio. Rede pública continua bloqueada,
que é o certo.

---

## 5. Nos outros PCs

Abra o navegador e digite o endereço `http://192.168.0.10:8080` (o que apareceu
na janela). Salve nos favoritos.

Peça a quem cuida da rede para **fixar o IP** do servidor. Sem isso, o número
pode mudar quando o PC reiniciar e os favoritos param de funcionar.

---

## 6. Deixar ligando sozinho

1. `Windows + R`, digite `shell:startup`, Enter
2. Arraste o `Gestao.bat` para essa pasta segurando `Alt` (cria um atalho)

---

## Depois: atualizar para uma versão nova

1. Feche a janela do `Gestao.bat`
2. Dois cliques em **`Atualizar.bat`**
3. Abra o `Gestao.bat` de novo

Ele faz backup do banco antes de qualquer coisa, baixa a versão nova, confere
se está coerente e só então libera. O banco se ajusta sozinho — nenhum comando
para rodar à mão, nenhum lançamento antigo é tocado.

---

## Se der errado

| O que aparece | O que fazer |
|---|---|
| `node não é reconhecido` | O Node.js não foi instalado, ou o PC não reiniciou depois |
| `git não é reconhecido` | Instale o Git em <https://git-scm.com> |
| `PARE AQUI. Esta pasta está dentro do OneDrive` | Mova a pasta para fora de qualquer pasta sincronizada |
| Outro PC não abre o endereço | Rode `Liberar na rede.bat` como administrador no servidor |
| Abre no servidor mas não nos outros | Mesma coisa: é o firewall |
| Parou de abrir do nada | O IP do servidor mudou. Veja o novo na janela do `Gestao.bat` |
| A planilha não foi encontrada | Rode `npm run importar -- "caminho\da\planilha.xlsx"` |
