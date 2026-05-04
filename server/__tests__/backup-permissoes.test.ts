/**
 * Testes do helper `exigirDonoOuAdmin` que controla acesso às procedures
 * de backup do escritório.
 *
 * Cobre os 4 caminhos de bypass + 1 caminho de rejeição:
 *
 *  1. cargo "dono" canônico → passa (compat com check antigo).
 *  2. cargo customizado mas é dono via ownerId → passa.
 *  3. cargo customizado E não é ownerId → falha 403.
 *  4. impersonatedBy presente (admin Jurify impersonando) → passa.
 *  5. role "admin" direto (sem impersonação) → passa.
 *
 * Função é stateless — testes diretos sem mock de DB.
 */
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { exigirDonoOuAdmin } from "../escritorio/router-backup";

const escDonoId42 = {
  escritorio: { ownerId: 42 },
  colaborador: { cargo: "dono" },
};

describe("exigirDonoOuAdmin", () => {
  it("aceita cargo 'dono' canônico (compat)", () => {
    expect(() =>
      exigirDonoOuAdmin({ id: 42, role: "user" }, escDonoId42),
    ).not.toThrow();
  });

  it("aceita cargo customizado quando o usuário é o ownerId do escritório", () => {
    // Cliente que tem cargo personalizado "Dono" capitalizado ou "Sócio
    // Fundador". Continua sendo o dono real via FK ownerId.
    expect(() =>
      exigirDonoOuAdmin(
        { id: 42, role: "user" },
        {
          escritorio: { ownerId: 42 },
          colaborador: { cargo: "Sócio Fundador" },
        },
      ),
    ).not.toThrow();
  });

  it("aceita admin Jurify impersonando (impersonatedBy presente)", () => {
    // Caso reportado no bug: admin abre /admin → impersona cliente Rafael
    // Rocha → ctx.user vira o user-alvo (Rafael), mas ctx.user.impersonatedBy
    // tem o openId do admin original. Mesmo se o cargo do impersonado não
    // for exatamente "dono" (ex: "gestor", ou cargo customizado), o admin
    // tem privilégio pra rodar backup pra dar suporte.
    expect(() =>
      exigirDonoOuAdmin(
        { id: 99, role: "user", impersonatedBy: "admin-openid-abc" },
        {
          escritorio: { ownerId: 42 },
          colaborador: { cargo: "gestor" },
        },
      ),
    ).not.toThrow();
  });

  it("aceita admin Jurify acessando direto (role admin, sem impersonação)", () => {
    expect(() =>
      exigirDonoOuAdmin(
        { id: 1, role: "admin" },
        {
          escritorio: { ownerId: 42 },
          colaborador: { cargo: "atendente" },
        },
      ),
    ).not.toThrow();
  });

  it("rejeita cliente comum sem cargo dono e sem ser owner", () => {
    let erro: unknown;
    try {
      exigirDonoOuAdmin(
        { id: 99, role: "user" },
        {
          escritorio: { ownerId: 42 },
          colaborador: { cargo: "gestor" },
        },
      );
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(TRPCError);
    expect((erro as TRPCError).code).toBe("FORBIDDEN");
    expect((erro as TRPCError).message).toMatch(/dono.*backup/i);
  });

  it("rejeita cargo similar mas não exato (case-sensitive na compat)", () => {
    // "Dono" capitalizado só passa via ownerId — não pelo branch de cargo.
    // Esse teste garante que o branch de cargo é lowercase exato (intencional,
    // pra forçar uso do ownerId pra cargos não-canônicos).
    expect(() =>
      exigirDonoOuAdmin(
        { id: 99, role: "user" },
        {
          escritorio: { ownerId: 42 },
          colaborador: { cargo: "Dono" },
        },
      ),
    ).toThrow(TRPCError);
  });
});
