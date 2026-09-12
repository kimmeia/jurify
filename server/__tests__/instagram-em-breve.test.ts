/**
 * Instagram e Messenger ainda não recebem nem enviam mensagem: o webhook da
 * Meta descarta tudo que não é `whatsapp_business_account` e o envio recusa
 * qualquer tipo que não seja `whatsapp_api`. Mesmo assim o site, o plano
 * Atende, o banner da aba Canais e a dica do ChatGPT vendiam os dois como
 * prontos — e o card "Instagram Business" abria o diálogo de conexão real.
 *
 * Decisão do dono: os nomes FICAM (Instagram continua no site, no plano e na
 * tela), mas com "em breve" ao lado; e-mail idem no card omnichannel. A fonte
 * única é `canalEmBreve`, que lê a flag de `TIPO_CANAL_META` — quando o canal
 * ficar pronto, tira-se a flag e cada tela para de dizer "em breve" sozinha.
 *
 * Este teste trava: a flag e o helper; os textos novos nos sete arquivos (e
 * que "Instagram" não sumiu de nenhum — o combinado foi avisar, não apagar);
 * o guard do clique no card; e a migration que troca SÓ o primeiro bullet do
 * plano Atende, só se ele ainda for o texto antigo.
 */

import { describe, expect, it } from "vitest";

import { GATILHO_META, TIPO_CANAL_META, canalEmBreve } from "../../shared/smartflow-types";
import { ler, semComentarios } from "./_paginas-publicas";

const ARQUIVOS = {
  tipos: "shared/smartflow-types.ts",
  integracoes: "client/src/pages/landing/Integracoes.tsx",
  pilares: "client/src/pages/landing/Pilares.tsx",
  configuracoes: "client/src/pages/Configuracoes.tsx",
  metaDialog: "client/src/pages/configuracoes/meta-connect-dialog.tsx",
  dialogs: "client/src/pages/configuracoes/dialogs.tsx",
  cenarioCard: "client/src/pages/smartflow/cenario-card.tsx",
} as const;

const MIGRATION = "drizzle/0222_instagram_em_breve_plano_atende.sql";
const BULLET_ANTIGO = "Atendimento no WhatsApp oficial (API Meta) e Instagram — 1 número";
const BULLET_NOVO = "Atendimento no WhatsApp oficial (API Meta) — 1 número · Instagram em breve";

describe("canalEmBreve é a fonte única do 'em breve' de canal", () => {
  it("instagram e facebook estão marcados em TIPO_CANAL_META; whatsapp_api não", () => {
    const porId = Object.fromEntries(TIPO_CANAL_META.map((m) => [m.id, m.emBreve === true]));
    expect(porId).toEqual({ whatsapp_api: false, instagram: true, facebook: true });
  });

  it("o helper lê a flag: instagram/facebook = true, whatsapp_api = false", () => {
    expect(canalEmBreve("instagram")).toBe(true);
    expect(canalEmBreve("facebook")).toBe(true);
    expect(canalEmBreve("whatsapp_api")).toBe(false);
  });

  it("tipo desconhecido ou vazio não é 'em breve' — não some botão de canal real", () => {
    expect(canalEmBreve("messenger")).toBe(false);
    expect(canalEmBreve(null)).toBe(false);
    expect(canalEmBreve(undefined)).toBe(false);
    expect(canalEmBreve("")).toBe(false);
  });

  it("o helper consulta TIPO_CANAL_META, não uma lista própria", () => {
    const fonte = semComentarios(ler(ARQUIVOS.tipos));
    const corpo = fonte.slice(fonte.indexOf("export function canalEmBreve"));
    const fim = corpo.indexOf("\n}");
    expect(corpo.slice(0, fim)).toContain("TIPO_CANAL_META");
  });

  it("o gatilho 'Mensagem recebida' diz WhatsApp e avisa que Instagram e Facebook vêm depois", () => {
    const gatilho = GATILHO_META.find((g) => g.id === "mensagem_canal");
    expect(gatilho?.descricao).toBe(
      "Dispara quando chega mensagem no WhatsApp (Instagram e Facebook em breve).",
    );
  });
});

describe("os textos avisam 'em breve' sem apagar o Instagram", () => {
  it("landing: chip Instagram tem emBreve e o pill 'em breve' na paleta warning", () => {
    const fonte = ler(ARQUIVOS.integracoes);
    expect(fonte).toContain('{ nome: "Instagram", cor: "bg-[#e1306c]", emBreve: true }');
    expect(fonte).toMatch(/i\.emBreve && \([\s\S]*?bg-warning-bg[\s\S]*?em breve/);
    // Os outros chips não mudam.
    expect(fonte).toContain('{ nome: "Asaas", cor: "bg-success" }');
    expect(fonte).toContain('{ nome: "WhatsApp", cor: "bg-[#25d366]" }');
    expect(fonte).toContain('{ nome: "PJe · TJCE", cor: "bg-info" }');
    expect(fonte).toContain('{ nome: "BACEN", cor: "bg-warning" }');
  });

  it("landing: card omnichannel fala só de WhatsApp hoje e mantém Instagram e e-mail como 'em breve'", () => {
    const fonte = ler(ARQUIVOS.pilares).replace(/\s+/g, " ");
    expect(fonte).toContain(
      "WhatsApp num inbox só — Instagram e e-mail em breve. Brief de IA, linha do tempo unificada e resposta sugerida. O lead nunca esfria.",
    );
    expect(fonte).not.toContain("WhatsApp, Instagram e e-mail num inbox só");
    expect(fonte).toMatch(/Instagram <span[^>]*bg-warning-bg[^>]*>[^<]*<i[^>]*bg-warning[^>]*\/> em breve<\/span>/);
  });

  it("aba Canais: banner, descrição dos cards e botão 'Em breve'", () => {
    const fonte = ler(ARQUIVOS.configuracoes).replace(/\s+/g, " ");
    expect(fonte).toContain(
      "O WhatsApp se conecta com 1 clique, sem copiar tokens ou IDs — basta autorizar pelo Facebook Login. Instagram e Messenger: em breve.",
    );
    expect(fonte).not.toContain("WhatsApp, Instagram e Messenger se conectam com 1 clique");
    const descricao =
      "Ainda não recebe nem envia mensagens. Quando estiver pronto, você conecta com 1 clique pelo Facebook Login.";
    // Uma vez pro Instagram Business, uma pro Messenger.
    expect(fonte.split(descricao).length - 1).toBe(2);
    expect(fonte).toContain('nome: "Instagram Business"');
    expect(fonte).toContain('nome: "Facebook Messenger"');
    expect(fonte).toContain('emBreve: canalEmBreve("instagram")');
    expect(fonte).toContain('emBreve: canalEmBreve("facebook")');
    // Botão travado com o texto "Em breve".
    expect(fonte).toMatch(/disabled=\{canal\.emBreve\}\s*>\s*\{canal\.emBreve \? "Em breve"/);
    // Pill ao lado do nome, mesmo markup do Twilio na aba Integrações.
    expect(fonte).toMatch(
      /\{canal\.emBreve && \( <span className="inline-flex items-center gap-1 px-1\.5 py-0\.5 rounded-full bg-warning-bg text-warning-fg text-\[9px\] font-bold"> <span className="w-1 h-1 rounded-full bg-warning" \/> Em breve <\/span> \)\}/,
    );
  });

  it("aba Canais: o pill 'Em breve' não depende do 'Conectado' — os dois aparecem juntos", () => {
    const fonte = ler(ARQUIVOS.configuracoes).replace(/\s+/g, " ");
    // O pill é condicionado SÓ por emBreve; o badge Conectado continua com a
    // condição de sempre (sem `!canal.emBreve`).
    expect(fonte).toContain("{canal.emBreve && ( <span");
    expect(fonte).toContain("{!canal.isAdicionar && canal.conectado && ( <Badge");
    expect(fonte).not.toContain("!canal.emBreve && canal.conectado");
  });

  it("aba Canais: a contagem 'N canais disponíveis' continua sobre a lista inteira", () => {
    const fonte = ler(ARQUIVOS.configuracoes);
    expect(fonte).toContain("{canaisPrincipais.length} canais disponíveis");
  });

  it("diálogo de conexão: aviso 'em breve' e botão 'Conectar com Facebook' travado", () => {
    const fonte = ler(ARQUIVOS.metaDialog).replace(/\s+/g, " ");
    expect(fonte).toContain('import { canalEmBreve } from "@shared/smartflow-types"');
    expect(fonte).toContain("const emBreve = canalEmBreve(TIPO_CANAL_DO_DIALOGO[channel])");
    expect(fonte).toContain('messenger: "facebook"');
    expect(fonte).toContain("<strong>Em breve.</strong> Este canal ainda não recebe nem envia mensagens.");
    expect(fonte).toContain("disabled={conectando || !sdkLoaded || emBreve}");
    expect(fonte).toContain('"Conectar com Facebook"');
  });

  it("dica do ChatGPT: WhatsApp; Instagram em breve", () => {
    const fonte = ler(ARQUIVOS.dialogs).replace(/\s+/g, " ");
    expect(fonte).toContain(
      "vincular a canais (WhatsApp; Instagram em breve) e ativar respostas automáticas.",
    );
  });

  it("legenda dos gatilhos do SmartFlow", () => {
    const fonte = ler(ARQUIVOS.cenarioCard);
    expect(fonte).toContain('label: "Mensagem (WhatsApp · Instagram e Facebook em breve)"');
    expect(fonte).not.toContain("Mensagem (WhatsApp · Instagram · Facebook)");
  });

  it("a palavra 'Instagram' não sumiu de nenhum dos sete arquivos", () => {
    for (const caminho of Object.values(ARQUIVOS)) {
      expect(ler(caminho), caminho).toContain("Instagram");
    }
  });
});

describe("o card do canal 'em breve' não abre o diálogo de conexão", () => {
  it("o onClick do <Card> consulta canal.emBreve antes de setMetaDialog", () => {
    const fonte = semComentarios(ler(ARQUIVOS.configuracoes)).replace(/\s+/g, " ");
    expect(fonte).toContain("onClick={() => { if (canal.emBreve) return; setMetaDialog(canal.dialog); }}");
    // O caminho antigo — clique direto abre o diálogo — não pode voltar.
    expect(fonte).not.toContain("onClick={() => setMetaDialog(canal.dialog)}");
  });

  it("canal.emBreve vem do helper, não de uma lista da tela", () => {
    const fonte = ler(ARQUIVOS.configuracoes);
    expect(fonte).toContain('import { canalEmBreve } from "@shared/smartflow-types"');
    expect(fonte.match(/emBreve: canalEmBreve\(/g)?.length).toBe(2);
  });
});

describe("migration 0222: só o primeiro bullet do plano Atende, só se ainda for o antigo", () => {
  const sql = ler(MIGRATION);
  const semComentario = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("usa JSON_REPLACE no índice 0 com o texto novo", () => {
    expect(semComentario).toContain(`JSON_REPLACE(features, '$[0]', '${BULLET_NOVO}')`);
    expect(semComentario).not.toMatch(/JSON_REPLACE\(features, '\$\[[1-9]/);
    expect(semComentario).not.toContain("JSON_ARRAY(");
  });

  it("o WHERE amarra o slug 'atende' e o texto antigo da 0217 (idempotente)", () => {
    expect(semComentario).toContain("UPDATE planos");
    expect(semComentario).toContain("WHERE slug = 'atende'");
    expect(semComentario).toContain(
      `JSON_UNQUOTE(JSON_EXTRACT(features, '$[0]')) = '${BULLET_ANTIGO}'`,
    );
    // Texto antigo é o que a 0217 gravou, palavra por palavra.
    expect(ler("drizzle/0217_pacote_3_planos.sql")).toContain(`'${BULLET_ANTIGO}'`);
  });

  it("é um único UPDATE, sem outro DML", () => {
    const statements = semComentario
      .split(/;\s*\n?/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(1);
    expect(statements[0].startsWith("UPDATE planos")).toBe(true);
  });
});
