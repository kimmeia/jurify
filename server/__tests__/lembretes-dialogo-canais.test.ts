/**
 * Amarra de texto — lembretes nas duas telas que criam compromisso.
 *
 *  - `NovoCompromissoDialog` oferecia E-mail e WhatsApp como canal de
 *    lembrete, e o cron só despacha notificação no app (os outros dois só
 *    logam "não implementado"). A Agenda já desabilitava os dois com
 *    `const disabled = c.id !== "notificacao_app"`; o diálogo passa a fazer
 *    o MESMO — as opções continuam lá, desabilitadas e marcadas "em breve".
 *  - `CriarEventoDialog` (Agenda) fica sempre montado: editar o evento A
 *    (com lembretes) e depois o B só pra trocar o título gravava os
 *    lembretes de A em B. A hidratação (edição e criação) zera os três
 *    estados, e lista vazia de lembretes existentes também zera.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function ler(rel: string) {
  return fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf-8");
}

const PADRAO_DISABLED = 'const disabled = c.id !== "notificacao_app";';
const RESET_LEMBRETES =
  'setLembreteMinutos([30]); setLembreteCanais(["notificacao_app"]); setLembreteDestinatarios([]);';

describe("NovoCompromissoDialog — canais de lembrete", () => {
  const dialogo = ler("client/src/components/NovoCompromissoDialog.tsx");
  const agenda = ler("client/src/pages/Agenda.tsx");

  it("as três opções continuam presentes (nada foi removido)", () => {
    const bloco = dialogo.slice(dialogo.indexOf("const CANAIS_LEMBRETE"), dialogo.indexOf("const DURACOES"));
    expect(bloco).toContain('id: "notificacao_app"');
    expect(bloco).toContain('id: "email"');
    expect(bloco).toContain('id: "whatsapp"');
  });

  it("E-mail e WhatsApp ficam desabilitados com o MESMO padrão da Agenda", () => {
    expect(agenda).toContain(PADRAO_DISABLED);
    expect(dialogo).toContain(PADRAO_DISABLED);
  });

  it("o disabled chega no SelectItem e o rótulo diz 'em breve'", () => {
    const bloco = dialogo.slice(dialogo.indexOf(PADRAO_DISABLED), dialogo.indexOf("</SelectContent>", dialogo.indexOf(PADRAO_DISABLED)));
    expect(bloco).toMatch(/<SelectItem[^>]*disabled=\{disabled\}/);
    expect(bloco).toMatch(/disabled && <span[^>]*>· em breve<\/span>/);
  });
});

describe("Agenda (CriarEventoDialog) — lembretes não vazam entre eventos", () => {
  const agenda = ler("client/src/pages/Agenda.tsx");
  const inicio = agenda.indexOf("function CriarEventoDialog(");
  expect(inicio).toBeGreaterThan(0);
  const dialog = agenda.slice(inicio);

  // O ramo de edição tem um `} else {` próprio (diaInteiro); o da criação é
  // o ÚLTIMO do bloco.
  const hidratacao = dialog.slice(dialog.indexOf("if (eventoEdit) {"), dialog.indexOf("}, [open, eventoEdit?.id]);"));
  const corte = hidratacao.lastIndexOf("} else {");
  const ramoEdit = hidratacao.slice(0, corte);
  const ramoCreate = hidratacao.slice(corte);

  it("a hidratação de EDIÇÃO zera minutos, canais e destinatários", () => {
    expect(corte).toBeGreaterThan(0);
    expect(ramoEdit).toContain(RESET_LEMBRETES);
  });

  it("a hidratação de CRIAÇÃO também zera", () => {
    expect(ramoCreate).toContain('setTipoEvento("compromisso")');
    expect(ramoCreate).toContain(RESET_LEMBRETES);
  });

  it("lista vazia de lembretes existentes é reset, não 'deixa como está'", () => {
    const i = dialog.indexOf("if (!isEdit || !lembretesExistentes) return;");
    expect(i, "o efeito de lembretesExistentes mudou de cara").toBeGreaterThan(0);
    const efeito = dialog.slice(i, i + 400);
    expect(efeito).toMatch(
      /if \(lembretesExistentes\.length === 0\) \{\s*setLembreteMinutos\(\[30\]\); setLembreteCanais\(\["notificacao_app"\]\); setLembreteDestinatarios\(\[\]\);\s*return;\s*\}/,
    );
    expect(dialog).not.toContain("|| lembretesExistentes.length === 0) return;");
  });
});
