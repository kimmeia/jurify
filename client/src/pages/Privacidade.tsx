/**
 * Política de Privacidade. Texto rascunho LGPD-compliant — REVISAR
 * COM ADVOGADO antes de lançamento real (especialmente DPO,
 * transferência internacional e bases legais específicas por dado).
 */

import { Link } from "wouter";

const ATUALIZADO_EM = "29 de abril de 2026";

export default function Privacidade() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link href="/" className="text-sm text-violet-600 hover:underline">&larr; Voltar</Link>
      <h1 className="text-3xl font-bold mt-4 mb-2">Política de Privacidade</h1>
      <p className="text-sm text-muted-foreground mb-8">Última atualização: {ATUALIZADO_EM}</p>

      <section className="prose prose-sm dark:prose-invert max-w-none space-y-6">
        <p>
          Esta Política descreve como o Jurify (&ldquo;nós&rdquo;) trata seus
          dados pessoais, em conformidade com a Lei Geral de Proteção de
          Dados (Lei 13.709/2018 &mdash; LGPD).
        </p>

        <h2 className="text-xl font-semibold pt-4">1. Quais dados coletamos</h2>
        <ul className="list-disc pl-6">
          <li><strong>Cadastro</strong>: nome, email, senha (hash), telefone, dados do escritório.</li>
          <li><strong>Operacionais</strong>: dados que você insere (clientes, processos, documentos, anotações).</li>
          <li><strong>Pagamento</strong>: processado pelo Asaas; recebemos apenas confirmação e identificadores. Não armazenamos número de cartão.</li>
          <li><strong>Técnicos</strong>: IP, user-agent, logs de acesso, telemetria de erros (via Sentry).</li>
        </ul>

        <h2 className="text-xl font-semibold pt-4">2. Pra que usamos</h2>
        <ul className="list-disc pl-6">
          <li>Prover e operar a Plataforma.</li>
          <li>Processar pagamentos e gerenciar assinaturas.</li>
          <li>Comunicar atualizações, manutenções e questões da conta.</li>
          <li>Detectar fraude, abuso e violações de segurança.</li>
          <li>Melhorar a Plataforma com dados agregados (estatísticas, sem identificação).</li>
        </ul>

        <h2 className="text-xl font-semibold pt-4">3. Bases legais (LGPD)</h2>
        <ul className="list-disc pl-6">
          <li><strong>Execução de contrato</strong> &mdash; pra prover o serviço contratado.</li>
          <li><strong>Cumprimento de obrigação legal</strong> &mdash; fiscal, regulatória.</li>
          <li><strong>Legítimo interesse</strong> &mdash; segurança, prevenção a fraude.</li>
          <li><strong>Consentimento</strong> &mdash; quando aplicável (ex: cookies não essenciais).</li>
        </ul>

        <h2 className="text-xl font-semibold pt-4">4. Compartilhamento</h2>
        <p>
          Compartilhamos dados apenas com operadores essenciais (todos sob
          contrato e LGPD-compliant):
        </p>
        <ul className="list-disc pl-6">
          <li><strong>Railway</strong> (hospedagem) e <strong>Backblaze B2</strong> (backups) &mdash; armazenamento.</li>
          <li><strong>Asaas</strong> &mdash; processamento de pagamentos.</li>
          <li><strong>Resend</strong> &mdash; envio de emails transacionais.</li>
          <li><strong>Sentry</strong> &mdash; monitoramento de erros (dados anonimizados).</li>
          <li><strong>Google</strong> &mdash; autenticação Google Sign-In (opcional).</li>
        </ul>
        <p>
          Não vendemos dados pessoais a terceiros. Não compartilhamos pra
          fins de marketing.
        </p>

        <h2 className="text-xl font-semibold pt-4">5. Seus direitos (LGPD art. 18)</h2>
        <p>Você pode, a qualquer momento:</p>
        <ul className="list-disc pl-6">
          <li>Acessar seus dados (exportação via suporte).</li>
          <li>Corrigir dados incorretos.</li>
          <li>Solicitar anonimização ou eliminação.</li>
          <li>Revogar consentimento (quando esta for a base legal).</li>
          <li>Saber com quem compartilhamos.</li>
          <li>Solicitar portabilidade pra outro fornecedor.</li>
        </ul>
        <p>
          Pra exercer: envie email pra <a href="mailto:privacidade@jurify.com.br" className="text-violet-600 hover:underline">privacidade@jurify.com.br</a>.
          Atendemos em até 15 dias úteis.
        </p>

        <h2 className="text-xl font-semibold pt-4">6. Retenção</h2>
        <p>
          Dados de cadastro: enquanto durar a assinatura + 60 dias após
          cancelamento (período de exportação) + obrigações legais (5 anos
          fiscais). Logs técnicos: 180 dias. Backups: 30 dias.
        </p>

        <h2 className="text-xl font-semibold pt-4">7. Segurança</h2>
        <ul className="list-disc pl-6">
          <li>HTTPS/TLS em toda comunicação.</li>
          <li>Senhas armazenadas com hash (scrypt).</li>
          <li>Chaves de API criptografadas (AES-256-GCM) no banco.</li>
          <li>Backups criptografados em bucket privado.</li>
          <li>Monitoramento de erros em tempo real.</li>
          <li>Acesso a dados de produção restrito a engenheiros autorizados.</li>
        </ul>

        <h2 className="text-xl font-semibold pt-4">8. Cookies</h2>
        <p>
          Usamos cookies essenciais pra manter sua sessão (login). Não usamos
          cookies de tracking publicitário de terceiros.
        </p>

        <h2 className="text-xl font-semibold pt-4">9. Crianças</h2>
        <p>
          A Plataforma é destinada a profissionais maiores de 18 anos. Não
          coletamos dados de menores.
        </p>

        <h2 className="text-xl font-semibold pt-4">10. Encarregado de Dados (DPO)</h2>
        <p>
          Encarregado: <em>a definir</em>. Contato:{" "}
          <a href="mailto:privacidade@jurify.com.br" className="text-violet-600 hover:underline">privacidade@jurify.com.br</a>.
        </p>

        <h2 className="text-xl font-semibold pt-4">11. ANPD</h2>
        <p>
          Você pode reclamar à Autoridade Nacional de Proteção de Dados
          (ANPD) caso entenda que seus direitos foram violados.
        </p>

        <h2 className="text-xl font-semibold pt-4">12. Alterações</h2>
        <p>
          Esta Política pode ser atualizada. Mudanças materiais serão
          comunicadas por email ou banner com ao menos 30 dias de
          antecedência.
        </p>
      </section>
    </div>
  );
}
