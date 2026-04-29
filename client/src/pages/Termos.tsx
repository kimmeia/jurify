/**
 * Termos de Uso. Texto rascunho conservador — REVISAR COM ADVOGADO
 * antes de lançamento real (especialmente seção de responsabilidades
 * e arbitragem).
 */

import { Link } from "wouter";

const ATUALIZADO_EM = "29 de abril de 2026";

export default function Termos() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link href="/" className="text-sm text-violet-600 hover:underline">&larr; Voltar</Link>
      <h1 className="text-3xl font-bold mt-4 mb-2">Termos de Uso</h1>
      <p className="text-sm text-muted-foreground mb-8">Última atualização: {ATUALIZADO_EM}</p>

      <section className="prose prose-sm dark:prose-invert max-w-none space-y-6">
        <p>
          Bem-vindo ao Jurify. Estes Termos de Uso (&ldquo;Termos&rdquo;) regulam o
          acesso e uso da plataforma Jurify (&ldquo;Plataforma&rdquo;), oferecida
          por <strong>Jurify Tecnologia Ltda.</strong> (&ldquo;Jurify&rdquo;,
          &ldquo;nós&rdquo;). Ao criar uma conta ou usar a Plataforma, você
          (&ldquo;Usuário&rdquo;) declara ter lido, entendido e concordado com estes
          Termos e com a Política de Privacidade.
        </p>

        <h2 className="text-xl font-semibold pt-4">1. Sobre a Plataforma</h2>
        <p>
          O Jurify é uma plataforma SaaS destinada a escritórios de advocacia,
          oferecendo ferramentas de gestão de clientes, processos, finanças,
          tarefas, atendimento e cálculos jurídicos. A Plataforma <strong>não
          presta consultoria jurídica</strong> nem substitui o julgamento do
          advogado responsável.
        </p>

        <h2 className="text-xl font-semibold pt-4">2. Cadastro e Conta</h2>
        <ul className="list-disc pl-6">
          <li>Você deve ter ao menos 18 anos e capacidade civil pra firmar contratos.</li>
          <li>Os dados cadastrais devem ser verdadeiros e atualizados.</li>
          <li>Você é responsável pela guarda de suas credenciais. Não compartilhe.</li>
          <li>Notifique-nos imediatamente em caso de uso não autorizado da conta.</li>
        </ul>

        <h2 className="text-xl font-semibold pt-4">3. Plano e Pagamento</h2>
        <p>
          A Plataforma é disponibilizada por meio de assinatura. O pagamento é
          processado via gateway terceiro (Asaas). O não pagamento na data
          devida pode resultar em suspensão do acesso. Ao cancelar a
          assinatura, o acesso permanece até o fim do período já pago.
        </p>

        <h2 className="text-xl font-semibold pt-4">4. Uso aceitável</h2>
        <p>É vedado:</p>
        <ul className="list-disc pl-6">
          <li>Usar a Plataforma para fins ilícitos, antiéticos ou que violem direitos de terceiros.</li>
          <li>Tentar acesso não autorizado, engenharia reversa ou exploração de vulnerabilidades.</li>
          <li>Carregar conteúdo ofensivo, infringente, malicioso ou em desacordo com a OAB.</li>
          <li>Compartilhar credenciais entre múltiplos profissionais não cadastrados como colaboradores.</li>
        </ul>

        <h2 className="text-xl font-semibold pt-4">5. Propriedade dos dados</h2>
        <p>
          Os dados inseridos por você (clientes, processos, documentos, etc.)
          pertencem a você. O Jurify atua apenas como operador desses dados,
          conforme a LGPD. Você pode exportar seus dados a qualquer momento
          através do suporte. Após cancelamento, seus dados ficam disponíveis
          por 60 dias para exportação e em seguida são excluídos.
        </p>

        <h2 className="text-xl font-semibold pt-4">6. Beta e disponibilidade</h2>
        <p>
          A Plataforma encontra-se em fase Beta. Funcionalidades podem mudar,
          ser adicionadas ou removidas. Buscaremos comunicar mudanças
          significativas com antecedência. A disponibilidade não é garantida em
          24/7 e pode haver janelas de manutenção.
        </p>

        <h2 className="text-xl font-semibold pt-4">7. Limitação de responsabilidade</h2>
        <p>
          O Jurify não se responsabiliza por: (i) perdas decorrentes de
          decisões jurídicas tomadas com base em informações da Plataforma; (ii)
          interrupções temporárias de serviço; (iii) ações de terceiros (gateway,
          provedores de email, etc.). A responsabilidade total do Jurify, em
          qualquer hipótese, fica limitada ao valor pago pelo Usuário nos
          últimos 12 meses.
        </p>

        <h2 className="text-xl font-semibold pt-4">8. Encerramento</h2>
        <p>
          Você pode cancelar sua conta a qualquer momento em
          Configurações &gt; Meu Plano. O Jurify pode encerrar contas que
          violem estes Termos, com aviso prévio quando possível.
        </p>

        <h2 className="text-xl font-semibold pt-4">9. Alterações</h2>
        <p>
          Estes Termos podem ser atualizados periodicamente. Mudanças
          materiais serão comunicadas por email ou banner na Plataforma com
          ao menos 30 dias de antecedência.
        </p>

        <h2 className="text-xl font-semibold pt-4">10. Lei e foro</h2>
        <p>
          Estes Termos regem-se pelas leis brasileiras. Fica eleito o foro da
          comarca de São Paulo/SP, salvo legislação consumerista que disponha
          de modo diverso.
        </p>

        <h2 className="text-xl font-semibold pt-4">Contato</h2>
        <p>
          Dúvidas: <a href="mailto:contato@jurify.com.br" className="text-violet-600 hover:underline">contato@jurify.com.br</a>
        </p>
      </section>
    </div>
  );
}
