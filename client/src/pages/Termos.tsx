/**
 * Termos de Uso — versão 2 (aceite versionado, shared/termos.ts).
 *
 * Texto de trabalho aprovado em mockup pelo dono; ele revisa o teor
 * jurídico antes de qualquer campanha. Mudança relevante aqui = bump em
 * TERMOS_VERSAO, que dispara o re-aceite bloqueante do dono (TermosGate).
 */

import { Link } from "wouter";
import { TERMOS_ATUALIZADO_EM, TERMOS_VERSAO } from "@shared/termos";

export default function Termos() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link href="/" className="text-sm text-info-fg hover:underline">&larr; Voltar</Link>
      <h1 className="text-3xl font-bold mt-4 mb-2">Termos de Uso</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Versão {TERMOS_VERSAO} &middot; Última atualização: {TERMOS_ATUALIZADO_EM} &middot; O aceite
        desta versão é registrado eletronicamente (data, hora, IP e versão).
      </p>

      <section className="prose prose-sm dark:prose-invert max-w-none space-y-6">
        <p>
          Bem-vindo ao JuridFlow. Estes Termos de Uso (&ldquo;Termos&rdquo;) regulam o
          acesso e uso da plataforma JuridFlow (&ldquo;Plataforma&rdquo;), oferecida
          por <strong>JuridFlow Tecnologia Ltda.</strong> (&ldquo;JuridFlow&rdquo;,
          &ldquo;nós&rdquo;). Ao criar uma conta ou usar a Plataforma, você
          (&ldquo;Usuário&rdquo;) &mdash; e o escritório de advocacia que você representa
          (&ldquo;Escritório&rdquo;) &mdash; declaram ter lido, entendido e concordado com
          estes Termos e com a Política de Privacidade.
        </p>

        <h2 className="text-xl font-semibold pt-4">1. Sobre a Plataforma</h2>
        <p>
          O JuridFlow é uma plataforma SaaS destinada a escritórios de advocacia:
          acompanhamento processual, monitoramento de movimentações e publicações,
          organização de clientes, prazos e módulos opcionais de atendimento,
          financeiro e cálculos. A Plataforma é uma <strong>ferramenta de
          meio</strong>: ela organiza e entrega informação &mdash; <strong>não presta
          consultoria jurídica</strong> nem substitui o julgamento do advogado
          responsável. As decisões profissionais tomadas a partir dela são do
          Escritório.
        </p>

        <h2 className="text-xl font-semibold pt-4">2. Cadastro e Conta</h2>
        <ul className="list-disc pl-6">
          <li>Você deve ter ao menos 18 anos e capacidade civil pra firmar contratos.</li>
          <li>Os dados cadastrais devem ser verdadeiros e atualizados.</li>
          <li>Você é responsável pela guarda de suas credenciais. Não compartilhe.</li>
          <li>Notifique-nos imediatamente em caso de uso não autorizado da conta.</li>
        </ul>

        <h2 className="text-xl font-semibold pt-4">3. Papéis no tratamento de dados (LGPD)</h2>
        <p>
          Para os dados pessoais que o Escritório insere, importa ou coleta pela
          Plataforma &mdash; dados de clientes, partes, contatos, processos,
          documentos e conversas (&ldquo;Dados de Terceiros&rdquo;) &mdash; o{" "}
          <strong>Escritório é o CONTROLADOR</strong>: é ele quem decide por que e
          como esses dados são tratados. O <strong>JuridFlow atua como
          OPERADOR</strong>: trata os Dados de Terceiros exclusivamente conforme as
          instruções do Escritório e para prestar o serviço contratado, com medidas
          técnicas de segurança (criptografia de credenciais, isolamento por
          escritório, controle de acesso), sem utilizá-los para fins próprios.
        </p>

        <h2 className="text-xl font-semibold pt-4">4. Dados de Terceiros e responsabilidade do Escritório</h2>
        <p>
          O Escritório <strong>declara possuir base legal</strong> (art. 7º da LGPD
          &mdash; como execução de contrato, exercício regular de direitos em processo
          ou consentimento) para todos os Dados de Terceiros que inserir na
          Plataforma, e é <strong>integral e exclusivamente responsável</strong>:
        </p>
        <ul className="list-disc pl-6">
          <li>pela licitude, exatidão e atualização desses dados;</li>
          <li>
            pelo uso que deles fizer, incluindo o envio de mensagens e comunicações
            (inclusive via WhatsApp, observadas as políticas da Meta), as consultas
            processuais realizadas com suas credenciais e as importações de sistemas
            de terceiros;
          </li>
          <li>pelos atos dos usuários que convidar para a sua conta.</li>
        </ul>
        <p>
          <strong>O uso indevido, ilícito ou sem base legal dos Dados de Terceiros
          pelo Escritório ou por seus usuários é de responsabilidade exclusiva do
          Escritório</strong>, que responderá pelos danos, multas e sanções
          decorrentes e manterá o JuridFlow indene de qualquer demanda de titulares
          de dados ou de autoridades que tenha origem nessa conduta.
        </p>

        <h2 className="text-xl font-semibold pt-4">5. Plano e Pagamento</h2>
        <p>
          A Plataforma é disponibilizada por meio de assinatura, composta pelo
          pacote contratado e por módulos adicionais quando contratados. O
          pagamento é processado via gateway terceiro (Asaas). O não pagamento na
          data devida pode resultar em suspensão do acesso. Ao cancelar a
          assinatura, o acesso permanece até o fim do período já pago.
        </p>

        <h2 className="text-xl font-semibold pt-4">6. Uso aceitável</h2>
        <p>É vedado:</p>
        <ul className="list-disc pl-6">
          <li>Usar a Plataforma para fins ilícitos, antiéticos ou que violem direitos de terceiros.</li>
          <li>Tentar acesso não autorizado, engenharia reversa ou exploração de vulnerabilidades.</li>
          <li>Carregar conteúdo ofensivo, infringente, malicioso ou em desacordo com a OAB.</li>
          <li>Compartilhar credenciais entre múltiplos profissionais não cadastrados como colaboradores.</li>
        </ul>

        <h2 className="text-xl font-semibold pt-4">7. Credenciais de tribunais</h2>
        <p>
          As credenciais que o Escritório cadastra no cofre da Plataforma são
          armazenadas cifradas e usadas exclusivamente para as consultas e
          monitoramentos que o próprio Escritório configurar. Manter as credenciais
          válidas e autorizadas junto aos tribunais é responsabilidade do
          Escritório.
        </p>

        <h2 className="text-xl font-semibold pt-4">8. Propriedade e portabilidade dos dados</h2>
        <p>
          Os Dados de Terceiros e demais dados inseridos pelo Escritório pertencem
          ao Escritório. Você pode exportar seus dados a qualquer momento através
          do suporte. Após cancelamento, seus dados ficam disponíveis por 60 dias
          para exportação e em seguida são excluídos.
        </p>

        <h2 className="text-xl font-semibold pt-4">9. Suboperadores</h2>
        <p>
          Para prestar o serviço, o JuridFlow utiliza suboperadores de tecnologia:
          infraestrutura de nuvem (Railway), backups (Backblaze B2), WhatsApp
          Business API (Meta), cobranças (Asaas), e-mail transacional (Resend),
          monitoramento de erros (Sentry) e provedores de inteligência artificial
          (<strong>OpenAI e Anthropic</strong>) &mdash; estes recebem apenas o conteúdo
          necessário para gerar os resumos e análises solicitados pelo Escritório e
          não usam esses dados para treinar modelos. A lista completa e atualizada
          vive na <Link href="/privacidade" className="text-info-fg hover:underline">Política de Privacidade</Link>.
        </p>

        <h2 className="text-xl font-semibold pt-4">10. Beta e disponibilidade</h2>
        <p>
          A Plataforma encontra-se em evolução contínua. Funcionalidades podem
          mudar, ser adicionadas ou removidas. Buscaremos comunicar mudanças
          significativas com antecedência. A disponibilidade não é garantida em
          24/7 e pode haver janelas de manutenção.
        </p>

        <h2 className="text-xl font-semibold pt-4">11. Limitação de responsabilidade</h2>
        <p>Nos limites da lei, o JuridFlow não se responsabiliza por:</p>
        <ul className="list-disc pl-6">
          <li>decisões profissionais tomadas com base nas informações exibidas na Plataforma;</li>
          <li>indisponibilidade, instabilidade ou mudança dos sistemas dos tribunais e fontes públicas consultadas;</li>
          <li>
            conteúdo gerado por inteligência artificial &mdash; resumos e análises são
            apoio e <strong>exigem revisão profissional</strong> antes de qualquer uso;
          </li>
          <li>perda de prazo ou dano decorrente de informação indisponível na fonte consultada;</li>
          <li>interrupções temporárias de serviço e ações de terceiros (gateway, provedores de email, etc.).</li>
        </ul>
        <p>
          A responsabilidade total do JuridFlow, em qualquer hipótese, fica
          limitada ao valor pago pelo Usuário nos últimos 12 meses.
        </p>

        <h2 className="text-xl font-semibold pt-4">12. Encerramento</h2>
        <p>
          Você pode cancelar sua conta a qualquer momento em
          Configurações &gt; Meu Plano. O JuridFlow pode encerrar contas que
          violem estes Termos, com aviso prévio quando possível.
        </p>

        <h2 className="text-xl font-semibold pt-4">13. Aceite, vigência e alterações</h2>
        <p>
          O aceite destes Termos é eletrônico e registrado com data, hora, IP e
          versão do documento. Alterações relevantes exigem novo aceite do
          responsável pelo Escritório no próximo acesso; mudanças materiais também
          são comunicadas por email ou aviso na Plataforma. A conta de teste
          (trial) está sujeita a estes mesmos Termos desde o cadastro.
        </p>

        <h2 className="text-xl font-semibold pt-4">14. Lei e foro</h2>
        <p>
          Estes Termos regem-se pelas leis brasileiras. Fica eleito o foro da
          comarca de São Paulo/SP, salvo legislação consumerista que disponha
          de modo diverso.
        </p>

        <h2 className="text-xl font-semibold pt-4">Contato</h2>
        <p>
          Dúvidas: <a href="mailto:contato@juridflow.com.br" className="text-info-fg hover:underline">contato@juridflow.com.br</a>
        </p>
      </section>
    </div>
  );
}
