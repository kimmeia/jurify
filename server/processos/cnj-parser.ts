/**
 * Parser de CNJ pra detectar tribunal e segmento de justiça.
 *
 * CNJ formato: NNNNNNN-DD.AAAA.J.TR.OOOO
 *   J  = segmento (1=STF, 4=JF, 5=JT, 8=JE, 9=JME)
 *   TR = tribunal (depende de J — ex: J=8,TR=06 = TJCE)
 *
 * Usado pelo roteador de fonte (motor próprio | Judit) em
 * `router-judit-processos.ts:consultarCNJ`. Pra cada CNJ, decide
 * se temos adapter motor próprio disponível.
 */

import { normalizarCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";

export type SegmentoJustica =
  | "estadual"
  | "trabalhista"
  | "federal"
  | "eleitoral"
  | "militar"
  | "militar_estadual"
  | "superior"
  | "desconhecido";

export type TribunalParseado = {
  /** "tjce", "tjsp", "trt2", "trt7", "trf4" — formato lowercase pra usar como key */
  codigoTribunal: string;
  /** "TJCE", "TJSP", "TRT-2" — formato display */
  siglaTribunal: string;
  segmento: SegmentoJustica;
  /** Estado/UF quando aplicável (CE, SP, RJ...) */
  uf: string | null;
  /** True se temos adapter motor próprio pra esse tribunal */
  temMotorProprio: boolean;
};

const TJ_MAP: Record<string, { sigla: string; uf: string }> = {
  "01": { sigla: "TJAC", uf: "AC" },
  "02": { sigla: "TJAL", uf: "AL" },
  "03": { sigla: "TJAP", uf: "AP" },
  "04": { sigla: "TJAM", uf: "AM" },
  "05": { sigla: "TJBA", uf: "BA" },
  "06": { sigla: "TJCE", uf: "CE" },
  "07": { sigla: "TJDF", uf: "DF" },
  "08": { sigla: "TJES", uf: "ES" },
  "09": { sigla: "TJGO", uf: "GO" },
  "10": { sigla: "TJMA", uf: "MA" },
  "11": { sigla: "TJMT", uf: "MT" },
  "12": { sigla: "TJMS", uf: "MS" },
  "13": { sigla: "TJMG", uf: "MG" },
  "14": { sigla: "TJPA", uf: "PA" },
  "15": { sigla: "TJPB", uf: "PB" },
  "16": { sigla: "TJPR", uf: "PR" },
  "17": { sigla: "TJPE", uf: "PE" },
  "18": { sigla: "TJPI", uf: "PI" },
  "19": { sigla: "TJRJ", uf: "RJ" },
  "20": { sigla: "TJRN", uf: "RN" },
  "21": { sigla: "TJRO", uf: "RO" },
  "22": { sigla: "TJRR", uf: "RR" },
  "23": { sigla: "TJRS", uf: "RS" },
  "24": { sigla: "TJSC", uf: "SC" },
  "25": { sigla: "TJSE", uf: "SE" },
  "26": { sigla: "TJSP", uf: "SP" },
  "27": { sigla: "TJTO", uf: "TO" },
};

/** Tribunais que temos adapter motor próprio funcional em produção. */
const TRIBUNAIS_COM_MOTOR_PROPRIO = new Set<string>([
  "tjce", // PJe TJCE 1º grau (validado 07/05/2026)
  // Próximos: "tjsp", "trt7", "tjrj"...
]);

/**
 * Mapeia código do tribunal pro valor `sistema` em `cofre_credenciais`.
 * Retorna null se não temos motor próprio (caller usa fallback Judit).
 *
 * Valores devem bater com `SistemaCofre` em shared/cofre-credenciais-types.ts.
 */
export function sistemaCofrePorTribunal(codigoTribunal: string): string | null {
  const map: Record<string, string> = {
    tjce: "pje_tjce",
    tjrj: "pje_tjrj",
    tjmg: "pje_tjmg",
    tjsp: "esaj_tjsp",
    // Adicionar conforme implementamos novos adapters
  };
  return map[codigoTribunal] ?? null;
}

/**
 * Extrai info do tribunal a partir do CNJ.
 *
 * Retorna `null` se CNJ inválido. Não valida dígito verificador (use
 * `validarCnj` separadamente se precisar).
 *
 * Exemplo:
 *   parseCnjTribunal("3024938-55.2026.8.06.0001") →
 *     { codigoTribunal: "tjce", siglaTribunal: "TJCE",
 *       segmento: "estadual", uf: "CE", temMotorProprio: true }
 */
export function parseCnjTribunal(cnj: string): TribunalParseado | null {
  const limpo = normalizarCnj(cnj);
  if (limpo.length !== 20) return null;

  const j = limpo.slice(13, 14); // segmento
  const tr = limpo.slice(14, 16); // tribunal

  // Justiça Estadual (J=8)
  if (j === "8") {
    const tj = TJ_MAP[tr];
    if (!tj) return null;
    const codigo = tj.sigla.toLowerCase();
    return {
      codigoTribunal: codigo,
      siglaTribunal: tj.sigla,
      segmento: "estadual",
      uf: tj.uf,
      temMotorProprio: TRIBUNAIS_COM_MOTOR_PROPRIO.has(codigo),
    };
  }

  // Justiça do Trabalho (J=5) — TR de 01 a 24 = TRT-N
  if (j === "5") {
    const numTr = parseInt(tr, 10);
    if (numTr >= 1 && numTr <= 24) {
      const codigo = `trt${numTr}`;
      return {
        codigoTribunal: codigo,
        siglaTribunal: `TRT-${numTr}`,
        segmento: "trabalhista",
        uf: null, // TRT cobre múltiplas UFs
        temMotorProprio: TRIBUNAIS_COM_MOTOR_PROPRIO.has(codigo),
      };
    }
  }

  // Justiça Federal (J=4) — TR de 01 a 06 = TRF-N
  if (j === "4") {
    const numTr = parseInt(tr, 10);
    if (numTr >= 1 && numTr <= 6) {
      const codigo = `trf${numTr}`;
      return {
        codigoTribunal: codigo,
        siglaTribunal: `TRF-${numTr}`,
        segmento: "federal",
        uf: null,
        temMotorProprio: TRIBUNAIS_COM_MOTOR_PROPRIO.has(codigo),
      };
    }
  }

  // Tribunais Superiores (STF=1, STJ=3) e demais segmentos: sem motor
  // próprio por enquanto. Retorna info parcial pra fallback Judit.
  return {
    codigoTribunal: `j${j}_tr${tr}`,
    siglaTribunal: `J${j}-${tr}`,
    segmento:
      j === "1" || j === "3"
        ? "superior"
        : j === "6"
          ? "eleitoral"
          : j === "7"
            ? "militar"
            : j === "9"
              ? "militar_estadual"
              : "desconhecido",
    uf: null,
    temMotorProprio: false,
  };
}

/** Conveniência: só retorna o código do tribunal (ou null) */
export function extrairCodigoTribunal(cnj: string): string | null {
  return parseCnjTribunal(cnj)?.codigoTribunal ?? null;
}

/** Conveniência: true se temos motor próprio pro CNJ */
export function temAdapterMotorProprio(cnj: string): boolean {
  return parseCnjTribunal(cnj)?.temMotorProprio ?? false;
}
