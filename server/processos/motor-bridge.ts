/**
 * Bridge: converte `ResultadoScraper` (formato motor próprio) →
 * `JuditLawsuit` (formato esperado pela UI atual em Processos.tsx).
 *
 * Decisão arquitetural: substituir Judit silenciosamente significa
 * que o frontend não muda. Todo lugar que consome `JuditLawsuit`
 * (cards, listagem, vinculação cliente) continua funcionando.
 *
 * Quando motor próprio retorna dados, este bridge transforma pra
 * shape Judit, que é injetado nos mesmos endpoints/tabelas.
 */

import type { JuditLawsuit } from "../integracoes/judit-client";
import type { ResultadoScraper } from "../../scripts/spike-motor-proprio/lib/types-spike";
import { parseCnjTribunal } from "./cnj-parser";

/**
 * Converte resultado do motor próprio em JuditLawsuit (shape pública).
 *
 * Retorna null se resultado falhou ou capa vazia (callers tratam).
 */
export function resultadoScraperParaJuditLawsuit(
  resultado: ResultadoScraper,
): JuditLawsuit | null {
  if (!resultado.ok || !resultado.capa) return null;

  const capa = resultado.capa;
  const tribunal = parseCnjTribunal(capa.cnj);

  // Mapeia partes: motor usa "ativo/passivo/terceiro" lowercase,
  // Judit usa "Active/Passive" (terceiro vira Active pra UI compatível).
  const parties: NonNullable<JuditLawsuit["parties"]> = capa.partes.map((p) => ({
    name: p.nome,
    side: (p.polo === "passivo" ? "Passive" : "Active") as "Active" | "Passive",
    person_type:
      p.tipo === "juridica"
        ? "Legal Entity"
        : p.tipo === "fisica"
          ? "Natural Person"
          : "Unknown",
    main_document: p.documento ?? undefined,
    lawyers: p.advogados.map((a) => ({
      name: a.nome,
      main_document: a.oab ?? undefined,
    })),
  }));

  // Mapeia movs → steps. Conta total pra `last_step.steps_count`.
  const steps: NonNullable<JuditLawsuit["steps"]> = resultado.movimentacoes.map(
    (m) => ({
      step_id: `motor:${m.data}:${m.texto.slice(0, 16)}`,
      step_date: m.data,
      content: m.texto,
      step_type: m.tipo ?? undefined,
    }),
  );

  // Última mov (mais recente — primeira no array, já que vem em ordem
  // cronológica decrescente do adapter)
  const lastStep = resultado.movimentacoes[0]
    ? {
        step_id: steps[0]?.step_id ?? "",
        step_date: resultado.movimentacoes[0].data,
        content: resultado.movimentacoes[0].texto,
        steps_count: resultado.movimentacoes.length,
      }
    : undefined;

  // Classifications: usa classe da capa como classificação principal
  const classifications: NonNullable<JuditLawsuit["classifications"]> =
    capa.classe ? [{ code: "main", name: capa.classe }] : [];

  // Subjects: assuntos da capa
  const subjects: NonNullable<JuditLawsuit["subjects"]> = capa.assuntos.map(
    (a, idx) => ({
      code: `motor-${idx}`,
      name: a,
    }),
  );

  return {
    code: capa.cnj,
    instance: 1, // TJCE 1º grau (Sprint 1). Sprint 2+: inferir do CNJ
    name: capa.classe ?? capa.cnj,
    tribunal_acronym: tribunal?.siglaTribunal ?? "DESCONHECIDO",
    county: capa.comarca ?? "",
    city: capa.comarca ?? "",
    state: capa.uf ?? "",
    distribution_date: capa.dataDistribuicao ?? "",
    status: capa.status ?? undefined,
    judge: capa.juiz ?? undefined,
    amount: capa.valorCausaCentavos ?? undefined,
    last_step: lastStep,
    subjects,
    parties,
    classifications,
    steps,
    // Atributos sem dado direto do motor próprio: phase, area,
    // justice_description, attachments. Podem ser implementados
    // em sprints futuras.
  };
}
