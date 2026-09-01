import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * "Este cliente é meu?" para quem tem `verProprios`.
 *
 * O caso (31/08): a Milena atendia um lead dela e o clique no nome girava
 * pra sempre. O motivo não era o que parecia — o portão olhava só
 * `contatos.responsavelId`, e contato que nasce de mensagem no WhatsApp entra
 * com esse campo VAZIO. Como `null !== <id dela>`, ela ficava sem enxergar
 * justamente os leads que eram dela. E como o campo nasce vazio, isso valia
 * pra quase todo lead do WhatsApp, não só pra aquele contato.
 *
 * Duas correções, autorizadas pelo dono item a item:
 *  (a) o portão passa a aceitar também o responsável do LEAD;
 *  (b) quem assume a conversa adota o contato que está sem responsável.
 *
 * O mesmo campo decide quem recebe a comissão das cobranças do cliente — por
 * isso (b) importa além do acesso.
 */

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("o portão enxerga o responsável do lead, não só o do cadastro", () => {
  const router = ler("server/escritorio/router-clientes.ts");
  const helper = router.slice(
    router.indexOf("async function ehResponsavelPeloContato"),
    router.indexOf("function contatosMeusPorLead"),
  );

  it("o helper existe e consulta a tabela de leads", () => {
    expect(helper.length).toBeGreaterThan(100);
    expect(helper).toContain("leads.responsavelId");
    expect(helper).toContain("leads.contatoId");
  });

  it("continua preso ao escritório — lead de outro tenant não libera nada", () => {
    expect(helper).toContain("leads.escritorioId");
  });

  it("o cadastro segue valendo primeiro (caminho barato, sem consulta extra)", () => {
    expect(helper).toMatch(/responsavelDoCadastro === colabId/);
  });

  it("o detalhe do cliente usa o helper, não a comparação crua", () => {
    const detalhe = router.slice(router.indexOf("detalhe: protectedProcedure"), router.indexOf("criar: protectedProcedure"));
    expect(detalhe).toContain("ehResponsavelPeloContato");
    // A comparação antiga é exatamente o bug: sem o lead, nega o que é dela.
    expect(detalhe).not.toMatch(/c\.responsavelId !== perm\.colaboradorId/);
  });

  it("a listagem usa a MESMA regra — senão a ficha abre e o cliente some da lista", () => {
    const listar = router.slice(router.indexOf("let where: any = eq(contatos.escritorioId"), router.indexOf("if (input?.busca)"));
    expect(listar).toContain("contatosMeusPorLead");
    expect(listar).toContain("or(");
  });

  it("verTodos continua passando direto, sem consultar lead", () => {
    const podeVer = router.slice(router.indexOf("async function podeVerCliente"), router.indexOf("async function buscarClienteDuplicadoCpf"));
    expect(podeVer).toMatch(/if \(verTodos\) return true;/);
  });
});

describe("quem assume a conversa adota o contato sem responsável", () => {
  const db = ler("server/escritorio/db-crm.ts");
  const adotar = db.slice(
    db.indexOf("async function adotarContatoSemResponsavel"),
    db.indexOf("export async function criarConversa"),
  );

  it("só preenche quando está vazio — nunca tira de quem já é responsável", () => {
    expect(adotar.length).toBeGreaterThan(100);
    expect(adotar).toContain("isNull(contatos.responsavelId)");
  });

  it("não atravessa escritório", () => {
    expect(adotar).toContain("contatos.escritorioId");
  });

  it("é best-effort — falhar aqui não pode derrubar o atendimento", () => {
    expect(adotar).toContain("try {");
    expect(adotar).toContain("catch");
  });

  it("vale ao criar a conversa E ao assumir/transferir depois", () => {
    const criar = db.slice(db.indexOf("export async function criarConversa"), db.indexOf("export async function marcarInicioAtendimento"));
    expect(criar).toContain("adotarContatoSemResponsavel");
    const atualizar = db.slice(db.indexOf("export async function atualizarConversa"), db.indexOf("export async function excluirConversa"));
    expect(atualizar).toContain("adotarContatoSemResponsavel");
    // Sem atendente definido não há quem adotar.
    expect(atualizar).toMatch(/if \(dados\.atendenteId\)/);
  });
});

describe("a ficha para de girar pra sempre", () => {
  const tela = ler("client/src/pages/Clientes.tsx");

  it("carregando e 'não posso ver' deixam de ser a mesma coisa", () => {
    // `detalhe` devolve null (não erro) em quatro situações distintas; tratar
    // isso como "ainda não chegou" era o spinner eterno.
    expect(tela).toContain("isLoading: detalheCarregando");
    const ini = tela.indexOf("if (detalheCarregando)");
    expect(ini).toBeGreaterThan(0);
    const trecho = tela.slice(ini, tela.indexOf("const isVip", ini));
    // O ramo do carregando mostra esqueleto (a forma da ficha) em vez de um
    // círculo girando — mas o que a amarra protege é que ele mostre ALGUMA
    // coisa de carregamento, e que o ramo do vazio não mostre nenhuma.
    expect(trecho).toContain("<Skeleton");
    expect(trecho).toContain("if (!cliente)");
    // O ramo do vazio precisa dizer algo e ter saída.
    const vazio = trecho.slice(trecho.indexOf("if (!cliente)"));
    expect(vazio).not.toContain("animate-spin");
    expect(vazio).not.toContain("<Skeleton");
    expect(vazio).toContain("onVoltar");
  });
});

describe("editar o nome do contato na conversa", () => {
  const tela = ler("client/src/pages/Atendimento.tsx");

  it("salva no cadastro do contato — que é onde o nome mora", () => {
    expect(tela).toContain("clientes.atualizar.useMutation");
    expect(tela).toContain("nomeEditando");
  });

  it("o lápis só aparece pra quem pode editar cliente", () => {
    expect(tela).toContain("podeEditarContato");
    expect(tela).toMatch(/permissoes\?\.clientes\?\.editar/);
    expect(tela).toContain("podeEditarContato && (");
  });

  it("Enter salva e Esc cancela", () => {
    const bloco = tela.slice(tela.indexOf("nomeEditando !== null"), tela.indexOf("Editar o nome do contato"));
    expect(bloco).toContain('e.key === "Enter"');
    expect(bloco).toContain('e.key === "Escape"');
  });

  it("nome vazio não é salvável (o servidor exige 2 caracteres)", () => {
    const bloco = tela.slice(tela.indexOf("nomeEditando !== null"), tela.indexOf("Editar o nome do contato"));
    expect(bloco).toMatch(/length < 2|length >= 2/);
  });
});

describe("o nome do contato não tem cópia pra dessincronizar", () => {
  it("a lista de conversas lê o nome do cadastro por junção", () => {
    const dbCrm = ler("server/escritorio/db-crm.ts");
    expect(dbCrm).toContain("contatoNome: contatos.nome");
  });

  it("lead não guarda nome próprio — só aponta pro contato", () => {
    const schema = ler("drizzle/schema.ts");
    const leads = schema.slice(schema.indexOf("export const leads = mysqlTable"), schema.indexOf("export const leads = mysqlTable") + 900);
    expect(leads).toContain("contatoIdLead");
    expect(leads).not.toMatch(/nome\w*Lead"/);
  });
});
