/**
 * Trabalhar não pode ser mais exigente que o motor que faz o trabalho.
 *
 * Criar monitoramento recusava com "Nenhuma credencial ativa de TJCE
 * encontrada" enquanto os monitoramentos já existentes rodavam contra o mesmo
 * tribunal, com a mesma credencial, naquele instante. A diferença estava num
 * filtro:
 *
 *   recuperarSessao (o que o motor usa)  → status ≠ removida
 *   cron de revalidação                  → ativa, validando, erro, expirada
 *   listagem do cofre                    → status ≠ removida
 *   as cinco cópias em processos.ts      → status = ativa
 *
 * `status` é indicador de saúde, não de existência. Uma falha passageira no
 * tribunal marca "erro"/"expirada", e a revalidação automática cura depois; o
 * motor nunca olhou esse campo, porque refaz o login quando precisa.
 *
 * Eram cinco cópias, duas rotuladas "mesma lógica de X" — a etiqueta que avisa
 * que vão divergir. O sintoma aparecia em uma; o defeito estava nas cinco.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const processos = ler("server/routers/processos.ts");
const helpers = ler("server/escritorio/cofre-helpers.ts");

const seletor = processos.slice(
  processos.indexOf("async function escolherCredencial("),
  processos.indexOf("export const processosRouter"),
);

describe("qual credencial serve", () => {
  it("a mesma que o motor aceita", () => {
    expect(seletor).toContain('ne(cofreCredenciais.status, "removida")');
  });

  it("é o mesmo critério do recuperarSessao", () => {
    // Se os dois divergirem de novo, volta o sintoma: criar falha, monitorar
    // funciona.
    expect(helpers).toContain('ne(cofreCredenciais.status, "removida")');
  });

  it("nenhum caminho do arquivo exige mais que isso", () => {
    expect(processos).not.toContain('eq(cofreCredenciais.status, "ativa")');
  });

  it("vale também quando a credencial é escolhida na mão", () => {
    // O ramo com id tinha o mesmo filtro estrito — escolher explicitamente uma
    // credencial marcada "erro" era recusado igual.
    const i = seletor.indexOf("if (opcoes.credencialId)");
    expect(seletor.slice(i, seletor.indexOf("const todas", i))).toContain("utilizavel");
  });

  it("prefere a mais saudável, sem excluir as outras", () => {
    // Começar por uma que precisa de relogin é só mais lento; recusá-la é
    // impedir o trabalho.
    expect(seletor).toContain("SAUDE_CREDENCIAL");
    expect(seletor).toContain("opcoes.sistemas.indexOf(c.sistema) * 10");
  });

  it("a ordem dos sistemas é a preferência de quem chamou", () => {
    // O TJCE quer pje antes de esaj; o consultarCNJ quer o sistema do tribunal
    // antes do PJe nacional. Um seletor só atende os dois sem saber deles.
    expect(processos).toContain('sistemas: ["pje_tjce", "esaj_tjce", SISTEMA_PJE_NACIONAL]');
    // `sistemasQueAtendem` devolve [específico, nacional], nessa ordem.
    expect(processos).toContain("sistemas: sistemasQueAtendem(tribunal.codigoTribunal)");
  });

  it("os fluxos por CPF aceitam a credencial nacional (pje_*)", () => {
    // O login do PDPJ é o mesmo em todos os estados — o Cofre recomenda
    // cadastrar como nacional. Os fluxos por CNJ aceitavam; os por CPF
    // (consultarDocumento e o "Monitorar" do cliente) recusavam a MESMA
    // credencial com "nenhuma de TJCE". Foi o erro visto em produção 20/08.
    expect(processos).not.toContain('sistemas: ["pje_tjce", "esaj_tjce"],');
    const mapeamentos = processos.match(/cred\.sistema === "esaj_tjce"|cred\.sistema === "pje_tjce"/g) ?? [];
    expect(mapeamentos.length).toBeGreaterThanOrEqual(2);
    // E o mapeamento sistema→tribunal não anula o curinga que o seletor aceitou.
    expect(processos).toContain('cred.sistema === SISTEMA_PJE_NACIONAL');
  });
});

describe("um lugar só, não uma cópia por chamador", () => {
  it("todos os caminhos passam pelo mesmo seletor", () => {
    const usos = processos.split("escolherCredencial(").length - 1;
    expect(usos, "a declaração mais cada chamador").toBeGreaterThanOrEqual(5);
  });

  it("as notas de 'mesma lógica' sumiram junto com a duplicata", () => {
    expect(processos).not.toContain("Mesma lógica de resolução de credencial");
  });
});

describe("a mensagem quando realmente não dá", () => {
  it("separa 'não tem nenhuma' de 'tem, mas de outro tribunal'", () => {
    // São problemas diferentes, e a mensagem antiga mandava cadastrar de novo
    // nos dois casos — inclusive pra quem já tinha cadastrado.
    expect(processos).toContain("mas nenhuma de TJCE");
    expect(processos).toContain("Nenhuma credencial no cofre");
  });

  it("diz o que encontrou, em vez de só negar", () => {
    expect(processos).toContain("encontrei:");
  });

  it("não chama de inativa uma credencial que o motor usaria", () => {
    expect(processos).not.toContain("Credencial não encontrada ou inativa");
  });
});
