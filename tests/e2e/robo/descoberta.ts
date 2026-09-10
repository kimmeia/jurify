/**
 * De onde sai o número de ações mapeadas.
 *
 * Ele não é escrito à mão. Lista de seletor à mão foi exatamente o que
 * deixou metade dos specs deste diretório em `fixme`: o app muda, o
 * seletor não, e o teste vira mentira ou vira ruído. Pior, um catálogo
 * fixo mede o que ALGUÉM lembrou de cadastrar — nunca o que o app tem.
 *
 * Aqui o robô conta a superfície olhando a tela: controles visíveis,
 * habilitados e com nome acessível, dentro do conteúdo (a navegação
 * lateral fica de fora, senão cada rota reconta o menu inteiro).
 *
 * Botão sem nome acessível não entra — e isso é de propósito. O robô
 * não sabe descrever no relatório o que clicou, e uma linha "clicou no
 * terceiro botão sem rótulo" não ajuda ninguém a consertar nada. Some
 * do mapa quando o botão ganhar `aria-label`.
 */

import type { Page } from "@playwright/test";
import type { AcaoDescoberta } from "./tipos";

/**
 * Controles que contam como ação. `a[href]` fora daqui de propósito:
 * link é navegação, e navegação já é coberta pelo robô de jornada.
 */
export const SELETOR_ALVOS = 'button, [role="button"], [role="menuitem"], [role="tab"]';

/** Regiões que não são conteúdo — repetem em toda rota. */
const REGIOES_IGNORADAS = '[data-sidebar], nav, header, [role="navigation"]';

export async function descobrirAcoes(
  page: Page,
  rota: string,
): Promise<AcaoDescoberta[]> {
  const nomes = await page.evaluate(
    ({ seletor, ignoradas }) => {
      const foraDeConteudo = new Set<Element>();
      for (const regiao of document.querySelectorAll(ignoradas)) {
        for (const el of regiao.querySelectorAll("*")) foraDeConteudo.add(el);
      }

      // `checkVisibility` é o que enxerga o que a régua manual não vê:
      // controle dentro de <details> recolhido, de `content-visibility`
      // ou de ancestral escondido. Sem ele o robô mapeava o "Abrir
      // backup" do /configuracoes — que mora num <details> fechado — e
      // depois reportava falha porque o clique, corretamente, não
      // acontecia. Ação que o usuário não alcança sem abrir a seção não
      // é superfície desta passada.
      const visivel = (el: Element) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const comChecagem = el as Element & { checkVisibility?: (o?: unknown) => boolean };
        if (typeof comChecagem.checkVisibility === "function") {
          return comChecagem.checkVisibility({
            contentVisibilityAuto: true,
            opacityProperty: true,
            visibilityProperty: true,
          });
        }
        const cs = getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.display !== "none";
      };

      const nomeAcessivel = (el: Element) => {
        const rotulo = el.getAttribute("aria-label") ?? el.textContent ?? "";
        return rotulo.replace(/\s+/g, " ").trim();
      };

      const encontrados: string[] = [];
      for (const el of document.querySelectorAll(seletor)) {
        el.removeAttribute("data-robo-acao");
        if (foraDeConteudo.has(el)) continue;
        if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
        if (!visivel(el)) continue;
        const nome = nomeAcessivel(el);
        // Rótulo quilométrico costuma ser card clicável inteiro, não
        // botão: o texto do card vazou pro nome acessível.
        if (!nome || nome.length > 60) continue;
        // Marcar aqui poupa o robô de reconstruir um seletor estável pra
        // cada controle — o que é justamente o que apodrece.
        el.setAttribute("data-robo-acao", String(encontrados.length));
        encontrados.push(nome);
      }
      return encontrados;
    },
    { seletor: SELETOR_ALVOS, ignoradas: REGIOES_IGNORADAS },
  );

  const vistos = new Map<string, number>();
  return nomes.map((nome, ocorrenciaDom) => {
    const chave = identidade(nome);
    const ocorrencia = vistos.get(chave) ?? 0;
    vistos.set(chave, ocorrencia + 1);
    return {
      id: `${rota}::${chave}::${ocorrencia}`,
      rota,
      nome,
      ocorrencia,
      ocorrenciaDom,
    };
  });
}

/**
 * Identidade não pode depender de dado.
 *
 * Meia dúzia de abas do app cola o contador no rótulo — o nome acessível
 * sai "Clientes5", "Todos5", "Leadsem atendimento0". O número chega
 * depois da primeira pintura, então o robô descobria "Clientes5",
 * recarregava a rota e reencontrava "Clientes": id diferente, controle
 * dado como sumido. Medido: 7 das 11 ações de /clientes viraram "a tela
 * não é estável entre visitas" por causa disso, sem nada estar quebrado.
 *
 * O dígito sai da identidade e fica no `nome`, que é o que o relatório
 * mostra pra pessoa.
 */
function identidade(nome: string): string {
  return nome.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
}
