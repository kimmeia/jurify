/**
 * Gera input mínimo válido a partir de um Zod schema.
 *
 * Cobre os tipos comuns que aparecem em procedures tRPC: string, number,
 * boolean, enum, array, object, optional, nullable, default, literal.
 * Não pretende cobrir 100% das semantics do Zod — procedures que usam
 * formas exóticas vão pra skip-list.
 *
 * Pra validações de string (email, url, uuid, regex, min/max), tenta
 * gerar valor que SATISFAZ. Quando não consegue, retorna "x" e a
 * validação tRPC vai falhar com BAD_REQUEST — que conta como sucesso
 * pro smoke (status 4xx é esperado, só falhamos em 5xx).
 */

import { ZodTypeAny, z } from "zod";

const SAMPLE_EMAIL = "smoke@jurify.com.br";

export function gerarInputMinimo(schema: ZodTypeAny | undefined): unknown {
  if (!schema) return undefined;

  // Desempacota wrappers (optional, nullable, default, effects/refine)
  const def = (schema as any)._def;
  if (!def) return undefined;

  const typeName = def.typeName as string;

  switch (typeName) {
    case "ZodOptional":
    case "ZodNullable":
      // Pra optional/nullable, retorna undefined — vai testar o caminho
      // sem valor. Mais rápido e não exige conhecer o tipo interno.
      return undefined;

    case "ZodDefault":
      // Tem default — usa ele.
      return typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue;

    case "ZodEffects":
      // Pode ser refine/transform — gera input do schema interno.
      return gerarInputMinimo(def.schema);

    case "ZodPipeline":
      // pipe: gera do schema de entrada (in)
      return gerarInputMinimo(def.in);

    case "ZodLazy":
      try {
        return gerarInputMinimo(def.getter());
      } catch {
        return undefined;
      }

    case "ZodLiteral":
      return def.value;

    case "ZodEnum":
      return def.values?.[0] ?? "x";

    case "ZodNativeEnum": {
      const vals = Object.values(def.values || {});
      return vals[0];
    }

    case "ZodString": {
      // Procura por validações específicas (email, url, uuid, etc).
      const checks: any[] = def.checks || [];
      for (const c of checks) {
        if (c.kind === "email") return SAMPLE_EMAIL;
        if (c.kind === "url") return "https://example.com";
        if (c.kind === "uuid") return "00000000-0000-0000-0000-000000000000";
        if (c.kind === "cuid") return "ckxxxxxxxx0000xxxxxxx";
        if (c.kind === "regex") return "x"; // pode falhar — aceitamos 4xx
      }
      // Min length: gera string com tamanho mínimo
      const minCheck = checks.find((c) => c.kind === "min");
      if (minCheck) return "x".repeat(minCheck.value);
      return "x";
    }

    case "ZodNumber": {
      const checks: any[] = def.checks || [];
      const minCheck = checks.find((c) => c.kind === "min");
      const intCheck = checks.find((c) => c.kind === "int");
      const base = minCheck ? minCheck.value : 0;
      return intCheck ? Math.ceil(base) : base;
    }

    case "ZodBigInt":
      return BigInt(0);

    case "ZodBoolean":
      return false;

    case "ZodDate":
      return new Date();

    case "ZodArray": {
      const checks: any[] = def.exactLength
        ? [{ value: def.exactLength.value }]
        : def.minLength
          ? [{ value: def.minLength.value }]
          : [];
      const min = checks[0]?.value ?? 0;
      const item = gerarInputMinimo(def.type);
      return Array.from({ length: min }, () => item);
    }

    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape || {})) {
        const value = gerarInputMinimo(v as ZodTypeAny);
        if (value !== undefined) out[k] = value;
      }
      return out;
    }

    case "ZodRecord":
      return {};

    case "ZodMap":
      return new Map();

    case "ZodSet":
      return new Set();

    case "ZodTuple": {
      const items: unknown[] = (def.items || []).map((s: ZodTypeAny) =>
        gerarInputMinimo(s),
      );
      return items;
    }

    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const opts = def.options;
      // Tenta a primeira opção.
      return gerarInputMinimo(opts?.[0]);
    }

    case "ZodIntersection":
      return {
        ...(gerarInputMinimo(def.left) as object),
        ...(gerarInputMinimo(def.right) as object),
      };

    case "ZodAny":
    case "ZodUnknown":
    case "ZodNever":
    case "ZodVoid":
    case "ZodNull":
    case "ZodUndefined":
      return undefined;

    default:
      // Tipo desconhecido — retorna undefined.
      return undefined;
  }
}

/** Versão "validada" — chama parseAsync no schema. Útil pra teste. */
export async function gerarValidando(schema: ZodTypeAny): Promise<unknown> {
  const sample = gerarInputMinimo(schema);
  try {
    return await schema.parseAsync(sample);
  } catch {
    return sample;
  }
}

// Re-export pra testes localizados
export { z };
