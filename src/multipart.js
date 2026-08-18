// Leitor de formulário com arquivo (multipart/form-data).
//
// Existe por um motivo só: o `POST /api/itens` do tablet manda os campos e a
// foto nesse formato, e o Express não sabe ler isso sozinho. Trazer uma
// biblioteca só para essa rota custaria caro do jeito errado — o sistema é
// instalado num PC da escola e a graça é `npm install` baixar quase nada.
//
// Cuidado ao mexer: o corpo é binário. Tudo aqui trabalha com Buffer, nunca com
// String. Converter o corpo inteiro para texto parece funcionar no teste com
// foto pequena e corrompe JPEG de verdade, porque byte que não é UTF-8 válido
// vira "?" na volta.

const CR = 0x0d, LF = 0x0a;

/** Acha a próxima ocorrência de [agulha] em [palheiro] a partir de [de]. */
function procurar(palheiro, agulha, de) {
  const i = palheiro.indexOf(agulha, de);
  return i === -1 ? -1 : i;
}

/**
 * Lê o corpo da requisição inteiro em memória, respeitando [limiteBytes].
 * Devolve o Buffer. Estoura antes de encher a memória se o cliente mentir no
 * Content-Length ou simplesmente não parar de mandar.
 */
export function lerCorpo(req, limiteBytes) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let total = 0;
    req.on("data", (p) => {
      total += p.length;
      if (total > limiteBytes) {
        reject(Object.assign(new Error("Arquivo grande demais."), { status: 413 }));
        req.destroy();
        return;
      }
      pedacos.push(p);
    });
    req.on("end", () => resolve(Buffer.concat(pedacos)));
    req.on("error", reject);
  });
}

/**
 * Separa um corpo multipart nas suas partes.
 *
 * Devolve `{ campos, arquivos }`:
 *   campos  — objeto nome -> texto (campos comuns do formulário)
 *   arquivos— objeto nome -> { nomeArquivo, tipo, dados: Buffer }
 *
 * Só o necessário para esta API: sem parte aninhada, sem codificação em
 * pedaços, sem campo repetido virando lista.
 */
export function separarPartes(corpo, contentType) {
  const marca = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!marca) throw Object.assign(new Error("Formulário sem separador."), { status: 400 });

  const limite = Buffer.from("--" + (marca[1] || marca[2]).trim());
  const campos = {};
  const arquivos = {};

  // O corpo é: --limite CRLF <parte> CRLF --limite CRLF <parte> ... --limite--
  let pos = procurar(corpo, limite, 0);
  if (pos === -1) throw Object.assign(new Error("Formulário malformado."), { status: 400 });

  while (pos !== -1) {
    let inicio = pos + limite.length;
    // "--" logo depois do limite marca o fim do formulário.
    if (corpo[inicio] === 0x2d && corpo[inicio + 1] === 0x2d) break;
    if (corpo[inicio] === CR && corpo[inicio + 1] === LF) inicio += 2;

    const fimCabecalho = procurar(corpo, Buffer.from("\r\n\r\n"), inicio);
    if (fimCabecalho === -1) break;

    const cabecalho = corpo.subarray(inicio, fimCabecalho).toString("utf8");
    const dadoInicio = fimCabecalho + 4;

    const proximo = procurar(corpo, limite, dadoInicio);
    if (proximo === -1) break;
    // O CRLF logo antes do próximo limite pertence ao protocolo, não ao dado.
    let dadoFim = proximo;
    if (corpo[dadoFim - 2] === CR && corpo[dadoFim - 1] === LF) dadoFim -= 2;

    const dados = corpo.subarray(dadoInicio, dadoFim);

    const nome = /name="([^"]*)"/i.exec(cabecalho)?.[1];
    const nomeArquivo = /filename="([^"]*)"/i.exec(cabecalho)?.[1];
    const tipo = /content-type:\s*([^\r\n]+)/i.exec(cabecalho)?.[1]?.trim();

    if (nome) {
      if (nomeArquivo !== undefined) {
        // filename="" é o campo de arquivo deixado em branco pelo navegador.
        if (nomeArquivo !== "" && dados.length) {
          arquivos[nome] = { nomeArquivo, tipo, dados };
        }
      } else {
        campos[nome] = dados.toString("utf8");
      }
    }
    pos = proximo;
  }

  return { campos, arquivos };
}
