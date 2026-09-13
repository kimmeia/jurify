/**
 * Conteúdo da Central de ajuda — dados puros, sem JSX.
 *
 * É a ÚNICA lista de tarefas do manual: home, página da tarefa e o "?" das
 * telas leem daqui (o teste `central-de-ajuda.test.ts` trava isso). Rótulos
 * citados nos textos vão entre «aspas angulares» e têm que existir, letra
 * por letra, no arquivo da tela (`arquivoTela` + `arquivosApoio`) — o mesmo
 * teste confere, pra que o manual não fale de botão que a tela não tem.
 */

import type { ModuloAppId } from "@shared/modulos-app";
import { modulosDaRota } from "@shared/modulos-contratacao";

/** Os mesmos grupos do menu lateral (GRUPOS_MENU do AppLayout), na mesma ordem. */
export const GRUPOS_AJUDA = ["Dia a dia", "Carteira", "Ferramentas", "Gestão"] as const;
export type GrupoAjuda = (typeof GRUPOS_AJUDA)[number];

export interface PassoAjuda {
  readonly titulo: string;
  readonly texto: string;
  /** Caminho público do print (`/ajuda/<tarefa>-<n>.png`, servido de client/public). */
  readonly print?: string;
}

export interface FalhaAjuda {
  readonly titulo: string;
  readonly texto: string;
}

export interface TarefaCompleta {
  readonly id: string;
  readonly titulo: string;
  readonly grupo: GrupoAjuda;
  readonly tempo: string;
  readonly quemPode: string;
  readonly palavrasChave: readonly string[];
  readonly antesDeComecar: string;
  readonly passos: readonly PassoAjuda[];
  readonly depois: readonly string[];
  readonly seNaoDeuCerto: readonly FalhaAjuda[];
  readonly tarefasLigadas: readonly string[];
  readonly abrirTela: { readonly rota: string; readonly rotulo: string };
  /** Arquivo da tela onde a tarefa acontece — o teste confere os rótulos nele. */
  readonly arquivoTela: string;
  /** Diálogos e sub-telas que os passos também citam. */
  readonly arquivosApoio?: readonly string[];
  /**
   * Módulo contratável que a tarefa exige: sem ele a página avisa, não
   * bloqueia. Quando a rota de «Abrir a tela» tem regra no ModuloGuard, é a
   * regra da rota que decide (ver `modulosQueLiberam`); este campo vale
   * sozinho só pra rota sem regra (Configurações esconde a aba por módulo).
   */
  readonly modulo?: ModuloAppId;
  readonly emBreve?: false;
}

export interface TarefaEmBreve {
  readonly id: string;
  readonly titulo: string;
  readonly grupo: GrupoAjuda;
  readonly emBreve: true;
  readonly palavrasChave?: readonly string[];
}

export type TarefaAjuda = TarefaCompleta | TarefaEmBreve;

export const TAREFAS_AJUDA = [
  // ───────────────────────────── Dia a dia ─────────────────────────────
  {
    id: "conectar-whatsapp",
    titulo: "Conectar o WhatsApp",
    grupo: "Dia a dia",
    tempo: "5 min",
    quemPode: "dono do escritório (ou quem tem acesso a Configurações)",
    modulo: "atendimento",
    palavrasChave: ["whatsapp", "canal", "facebook", "meta", "conectar", "número", "atendimento", "inbox", "mensagem"],
    antesDeComecar:
      "Um número de WhatsApp Business e acesso à conta do Facebook que administra a empresa. A conexão é pela API oficial da Meta, com 1 clique — sem copiar tokens e sem risco de banimento. Durante a conexão a Meta confirma o número por SMS ou ligação, então deixe o celular por perto.",
    passos: [
      {
        titulo: "Abrir «Canais» em Configurações",
        texto:
          "No menu lateral, clique na engrenagem (Configurações) e, no menu da esquerda, em «Canais». O cartão «WhatsApp Business» mostra o estado do número: sem nenhum conectado, o botão é «Conectar».",
        print: "/ajuda/conectar-whatsapp-1.png",
      },
      {
        titulo: "«Conectar com Facebook»",
        texto:
          "Na janela que abre, clique em «Conectar com Facebook». Você é levado ao Facebook pra autorizar: escolha a empresa, o número e confirme. Nenhuma senha fica guardada no JuridFlow — só o token de acesso, criptografado.",
      },
      {
        titulo: "Conferir o selo «Conectado»",
        texto:
          "De volta ao cartão, o selo vira «Conectado» e o botão passa a ser «Gerenciar». A partir daí, toda mensagem que chegar nesse número cai em Atendimento.",
      },
      {
        titulo: "Mandar uma mensagem de teste",
        texto:
          "Do seu celular, mande uma mensagem qualquer pro número conectado e abra Atendimento: a conversa aparece na lista em segundos. Quer que o robô responda sozinho? Veja a tarefa Passar a conversa pro robô ou assumir.",
      },
    ],
    depois: [
      "Toda mensagem que chegar no número aparece em Atendimento, na lista de conversas — com o nome do cadastro quando o telefone já é de um cliente.",
      "Dá pra conectar mais de um número: o cartão «Adicionar outro WhatsApp» aparece assim que o primeiro está no ar.",
      "Instagram e Messenger ainda não conectam por aqui — o cartão deles diz «Em breve».",
    ],
    seNaoDeuCerto: [
      {
        titulo: "Selo «Erro» no cartão",
        texto:
          "A autorização no Facebook não foi concluída (janela fechada ou permissão negada). Clique em «Reconectar» e aprove todas as permissões pedidas.",
      },
      {
        titulo: "O número já está em outro escritório",
        texto:
          "O mesmo número só pode estar conectado em um escritório do JuridFlow. Desconecte no outro antes, ou use outro número.",
      },
      {
        titulo: "Não consigo usar o Facebook Login",
        texto:
          "Há um caminho manual, discreto, embaixo do aviso da aba: «Ou cadastrar WhatsApp Cloud manualmente (avançado)». Ele exige os dados do app da Meta — fale com a gente antes.",
      },
    ],
    tarefasLigadas: ["responder-cliente-atendimento", "passar-conversa-robo-ou-assumir", "cadastrar-cliente"],
    abrirTela: { rota: "/configuracoes?tab=canais", rotulo: "Configurações → Canais" },
    arquivoTela: "client/src/pages/Configuracoes.tsx",
    arquivosApoio: ["client/src/pages/configuracoes/meta-connect-dialog.tsx"],
  },
  { id: "responder-cliente-atendimento", titulo: "Responder um cliente no Atendimento", grupo: "Dia a dia", emBreve: true, palavrasChave: ["conversa", "whatsapp", "responder"] },
  { id: "passar-conversa-robo-ou-assumir", titulo: "Passar a conversa pro robô ou assumir", grupo: "Dia a dia", emBreve: true, palavrasChave: ["robô", "bot", "assumir", "atendente ia"] },
  { id: "marcar-compromisso-lembrete", titulo: "Marcar um compromisso com lembrete", grupo: "Dia a dia", emBreve: true, palavrasChave: ["agenda", "compromisso", "lembrete", "audiência"] },
  { id: "encerrar-conversa", titulo: "Encerrar uma conversa", grupo: "Dia a dia", emBreve: true, palavrasChave: ["conversa", "encerrar", "resolvido"] },
  { id: "ver-o-que-chegou-hoje", titulo: "Ver o que chegou hoje (sino)", grupo: "Dia a dia", emBreve: true, palavrasChave: ["sino", "notificação", "movimentação"] },

  // ───────────────────────────── Carteira ──────────────────────────────
  {
    id: "cadastrar-cliente",
    titulo: "Cadastrar um cliente",
    grupo: "Carteira",
    tempo: "2 min",
    quemPode: "quem tem permissão de criar em Clientes (dono, gestor e atendentes, por padrão)",
    modulo: "clientes",
    palavrasChave: ["cliente", "cadastro", "contato", "lead", "cpf", "telefone", "novo cliente", "ficha"],
    antesDeComecar:
      "Os dados da pessoa: nome, telefone (WhatsApp), CPF ou CNPJ, a qualificação (profissão, estado civil, nacionalidade) e o endereço com CEP — a ficha completa é o que alimenta contratos e procurações depois. Se ela já mandou mensagem pelo WhatsApp, provavelmente já existe uma ficha: a tela avisa e oferece completar a que existe, em vez de criar outra.",
    passos: [
      {
        titulo: "Clicar em «Novo cliente»",
        texto: "Em Clientes, o botão «Novo cliente» fica no canto direito do painel do topo.",
        print: "/ajuda/cadastrar-cliente-1.png",
      },
      {
        titulo: "Preencher «Nome», «Telefone», «CPF/CNPJ», qualificação e «Endereço»",
        texto:
          "Tudo o que tem asterisco é obrigatório: além dos três primeiros, «Profissão», «Estado civil», «Nacionalidade» e o endereço («CEP», «Logradouro», «Número», «Bairro», «Cidade», «UF»). Digitou o «CEP»? A lupa ao lado preenche a rua e a cidade. «Email» é opcional. Enquanto você digita o telefone, o sistema confere se o número já está em algum cadastro.",
        print: "/ajuda/cadastrar-cliente-2.png",
      },
      {
        titulo: "Se aparecer «Este WhatsApp já está em um cadastro»",
        texto:
          "Escolha «Completar esse cadastro» pra preencher a ficha que já existe (o que veio do WhatsApp fica junto) ou «Criar separado mesmo assim» quando é outra pessoa usando o mesmo número.",
      },
      {
        titulo: "Escolher o «Responsável pelo atendimento» e «Cadastrar»",
        texto:
          "O responsável é quem vê a ficha quando o cargo só enxerga os próprios clientes, e é o padrão da comissão. «Valor do contrato (R$)» e «Origem» são opcionais — alimentam o relatório comercial. Clique em «Cadastrar».",
      },
    ],
    depois: [
      "A ficha abre na lista de Clientes, com histórico, documentos e financeiro em abas.",
      "Se a pessoa mandar mensagem do número cadastrado, a conversa em Atendimento já chega com o nome dela e o selo de cadastro reconhecido.",
      "Duas fichas com o mesmo telefone? A «Conferência de cadastros» lista e mescla — e dá pra desfazer por 7 dias.",
    ],
    seNaoDeuCerto: [
      {
        titulo: "«CPF/CNPJ já cadastrado»",
        texto: "Já existe ficha com esse documento. A tela mostra qual — abra essa e complete, em vez de criar outra.",
      },
      {
        titulo: "O botão «Cadastrar» fica travado",
        texto:
          "Falta algum campo com asterisco (a ficha pede qualificação e endereço, não só nome e telefone), ou o aviso de WhatsApp repetido está esperando a sua escolha.",
      },
      {
        titulo: "Não acho o botão «Novo cliente»",
        texto: "Seu cargo não tem permissão de criar em Clientes. Peça ao dono, em Configurações → Permissões.",
      },
    ],
    tarefasLigadas: ["conectar-whatsapp", "vigiar-processo", "cobrar-cliente"],
    abrirTela: { rota: "/clientes?novo=1", rotulo: "Clientes" },
    arquivoTela: "client/src/pages/Clientes.tsx",
    arquivosApoio: [
      "client/src/pages/clientes/detail-tabs.tsx",
      "client/src/components/CamposQualificacaoEndereco.tsx",
    ],
  },
  {
    id: "vigiar-processo",
    titulo: "Vigiar um processo",
    grupo: "Carteira",
    tempo: "3 min",
    quemPode: "dono ou quem tem permissão em Processos",
    modulo: "processos",
    palavrasChave: ["processo", "cnj", "monitoramento", "tribunal", "pje", "cofre", "credencial", "movimentação", "vigiar", "intimação"],
    antesDeComecar:
      "Você precisa de um acesso ao tribunal (o mesmo login que usa no PJe) guardado no Cofre. Se ainda não tem, comece pelo passo 1. Cada processo vigiado ocupa uma vaga do seu plano.",
    passos: [
      {
        titulo: "Guardar o acesso ao tribunal no Cofre",
        texto:
          "Em Processos, abra a aba «Cofre» e clique em «Nova credencial». Dê um «Apelido da credencial», escolha em «Onde essa credencial vale» o tribunal (e o grau, quando o PJe separa 1º e 2º), informe «CPF ou OAB» e «Senha» e clique em «Cadastrar e testar login». O sistema entra no tribunal na hora e mostra se deu certo.",
        print: "/ajuda/vigiar-processo-1.png",
      },
      {
        titulo: "Colar o número do processo",
        texto:
          "Aba «Monitoramento» → botão «Novo». Em «Número do processo (CNJ)» cole os 20 dígitos (com ou sem pontos) e escolha a «Credencial OAB» do passo 1. Se o tribunal do número ainda não estiver na cobertura, a tela avisa antes de cobrar e oferece «Avisar quando chegar».",
        print: "/ajuda/vigiar-processo-2.png",
      },
      {
        titulo: "Clicar em «Monitorar»",
        texto: "Se o processo já estava vigiado, a tela avisa e não cobra de novo.",
      },
      {
        titulo: "Ligar ao cliente (opcional, mas vale)",
        texto:
          "Na ficha do cliente, em Clientes, o botão «Vincular processo» liga o CNJ à pessoa. É isso que faz a movimentação aparecer na ficha dela e o sino avisar o responsável certo.",
      },
      {
        titulo: "Pronto — o robô confere todo dia",
        texto:
          "O sistema entra no tribunal com o seu acesso, lê as movimentações novas e marca as que exigem ação (prazo, intimação). Você não precisa voltar aqui.",
      },
    ],
    depois: [
      "Movimentação nova aparece na aba «Movimentações» de Processos e no sino; as que exigem ação ficam destacadas até alguém marcar como lida.",
      "O resumo em linguagem simples é feito por IA — o texto oficial do tribunal fica um clique abaixo.",
      "As pastilhas no topo da tela contam quantos processos estão vigiados e quantos estão parados.",
    ],
    seNaoDeuCerto: [
      {
        titulo: "O login falhou no Cofre",
        texto:
          "Senha errada, ou o tribunal pediu troca de senha ou verificação em duas etapas. Entre no PJe pelo navegador, confirme que entra, e clique em «Validar» na credencial.",
      },
      {
        titulo: "Tribunal fora da cobertura",
        texto:
          "O robô entra nos tribunais que aparecem no seletor da credencial (comprovado em campo no TJCE). Clique em «Avisar quando chegar» — você recebe um e-mail quando o tribunal ligar.",
      },
      {
        titulo: "Limite do plano",
        texto:
          "Acabaram as vagas de processos vigiados. Em Configurações → Meu plano dá pra trocar de plano; ou remova um processo que já encerrou.",
      },
      {
        titulo: "Processo «parado»",
        texto:
          "A pastilha aparece quando a credencial caiu ou foi removida. Abra o Cofre, valide a credencial ou reaponte o processo pra uma que esteja ativa.",
      },
    ],
    tarefasLigadas: ["descobrir-acoes-novas-cpf", "cadastrar-cliente", "ver-o-que-chegou-hoje"],
    abrirTela: { rota: "/processos?tab=movimentacoes", rotulo: "Processos" },
    arquivoTela: "client/src/pages/Processos.tsx",
    arquivosApoio: ["client/src/pages/Clientes.tsx"],
  },
  { id: "descobrir-acoes-novas-cpf", titulo: "Descobrir ações novas contra um cliente (CPF)", grupo: "Carteira", emBreve: true, palavrasChave: ["cpf", "novas ações", "réu"] },
  { id: "juntar-duas-fichas", titulo: "Juntar duas fichas do mesmo cliente", grupo: "Carteira", emBreve: true, palavrasChave: ["duplicado", "mesclar", "conferência"] },
  { id: "mover-caso-kanban", titulo: "Mover um caso no Kanban", grupo: "Carteira", emBreve: true, palavrasChave: ["kanban", "funil", "card"] },

  // ──────────────────────────── Ferramentas ────────────────────────────
  { id: "calculo-trabalhista", titulo: "Fazer um cálculo trabalhista", grupo: "Ferramentas", emBreve: true, palavrasChave: ["cálculo", "trabalhista", "rescisão"] },
  { id: "gerar-contrato-modelo", titulo: "Gerar um contrato a partir de modelo", grupo: "Ferramentas", emBreve: true, palavrasChave: ["contrato", "modelo", "assinatura"] },
  { id: "criar-fluxo-smartflow", titulo: "Criar um fluxo de mensagens (SmartFlow)", grupo: "Ferramentas", emBreve: true, palavrasChave: ["smartflow", "fluxo", "automação"] },
  { id: "atendente-ia-whatsapp", titulo: "Colocar um Atendente IA no WhatsApp", grupo: "Ferramentas", emBreve: true, palavrasChave: ["ia", "agente", "robô", "atendente"] },
  { id: "pesquisar-jurisia", titulo: "Pesquisar jurisprudência no JurisIA", grupo: "Ferramentas", emBreve: true, palavrasChave: ["jurisia", "jurisprudência", "pesquisa"] },

  // ────────────────────────────── Gestão ───────────────────────────────
  {
    id: "cobrar-cliente",
    titulo: "Cobrar um cliente (boleto ou Pix)",
    grupo: "Gestão",
    tempo: "2 min",
    quemPode: "quem tem permissão de criar no Financeiro",
    modulo: "financeiro",
    palavrasChave: ["cobrança", "boleto", "pix", "asaas", "financeiro", "honorários", "parcela", "recibo", "cobrar", "assinatura"],
    antesDeComecar:
      "O Asaas conectado — é ele que emite o boleto e o Pix (o botão «Conectar Asaas» aparece no topo do Financeiro enquanto não estiver) — e o cliente cadastrado com CPF ou CNPJ. Sem o Asaas dá pra registrar uma cobrança manual (dinheiro, transferência), mas sem boleto nem Pix.",
    passos: [
      {
        titulo: "Clicar em «Nova cobrança»",
        texto: "Em Financeiro, aba «Cobranças», clique em «Nova cobrança», no cabeçalho da tela.",
        print: "/ajuda/cobrar-cliente-1.png",
      },
      {
        titulo: "Escolher o tipo: «Avulsa», «Parcelada», «Recorrente» ou «Manual»",
        texto:
          "«Avulsa» é um boleto ou Pix só; «Parcelada» divide o valor em parcelas; «Recorrente» cria uma assinatura que se repete; «Manual» registra o que já foi pago por fora, sem passar pelo Asaas.",
        print: "/ajuda/cobrar-cliente-2.png",
      },
      {
        titulo: "Preencher «Cliente», «Valor (R$)», «Vencimento» e «Forma»",
        texto:
          "Em «Forma», escolha «Pix» ou «Boleto». A descrição aparece no boleto (ex.: honorários). «Atendente» e «Categoria» servem pra comissão e pro relatório — o padrão já vem preenchido.",
      },
      {
        titulo: "Clicar em «Criar»",
        texto:
          "O sistema gera a cobrança no Asaas e mostra o link do boleto e o QR Code do Pix; «Copiar Pix» copia o código pra mandar no WhatsApp.",
      },
    ],
    depois: [
      "A cobrança entra na lista de «Cobranças» com o status (pendente, paga, vencida) e aparece também na ficha do cliente.",
      "Quando o cliente paga, o Asaas avisa e o status muda sozinho — sem baixa manual.",
      "Cobrança paga vira base da comissão do atendente, se o escritório usa comissão.",
    ],
    seNaoDeuCerto: [
      {
        titulo: "«Asaas desconectado»",
        texto:
          "Só a cobrança «Manual» funciona. Conecte pelo botão «Conectar Asaas» (chave da API do Asaas) e volte.",
      },
      {
        titulo: "O Asaas recusou o cliente",
        texto: "Pra emitir boleto ou Pix, o Asaas exige CPF ou CNPJ na ficha. Complete o cadastro em Clientes e tente de novo.",
      },
      {
        titulo: "O botão «Criar» fica travado",
        texto:
          "Vencimento anterior a hoje trava o botão — só a cobrança «Manual» já paga aceita data passada. Confira também se cliente, valor e vencimento estão preenchidos.",
      },
    ],
    tarefasLigadas: ["cadastrar-cliente", "lancar-despesa", "ver-comissao-atendente"],
    abrirTela: { rota: "/financeiro", rotulo: "Financeiro" },
    arquivoTela: "client/src/pages/Financeiro.tsx",
    arquivosApoio: ["client/src/pages/financeiro/dialogs.tsx"],
  },
  { id: "lancar-despesa", titulo: "Lançar uma despesa", grupo: "Gestão", emBreve: true, palavrasChave: ["despesa", "financeiro", "gasto"] },
  { id: "ver-comissao-atendente", titulo: "Ver a comissão de cada atendente", grupo: "Gestão", emBreve: true, palavrasChave: ["comissão", "atendente", "vendas"] },
  {
    id: "convidar-equipe",
    titulo: "Convidar alguém e dar permissões",
    grupo: "Gestão",
    tempo: "3 min",
    quemPode: "dono (ou quem tem acesso a Configurações → Equipe)",
    palavrasChave: ["equipe", "convite", "colaborador", "permissão", "cargo", "atendente", "gestor", "usuário", "convidar", "senha"],
    antesDeComecar:
      "O e-mail da pessoa e o cargo que ela vai ter. O cargo define o que ela vê e pode fazer («Gestor», «Atendente», «Estagiário» ou um cargo criado por você). Cada plano tem um número de usuários — se a vaga acabou, o convite não sai.",
    passos: [
      {
        titulo: "Abrir «Equipe» e clicar em «Convidar colaborador»",
        texto:
          "Em Configurações, clique em «Equipe» no menu da esquerda. O botão «Convidar colaborador», no topo da lista, leva ao cartão «Convidar Colaborador», mais abaixo na mesma tela.",
        print: "/ajuda/convidar-equipe-1.png",
      },
      {
        titulo: "Preencher «Email» e «Cargo»",
        texto:
          "«Departamento» é opcional (serve pra distribuir o atendimento por setor). Clique em «Enviar Convite». A pessoa recebe um e-mail com o link; se não chegar, o botão de copiar o link aparece logo abaixo pra mandar pelo WhatsApp.",
        print: "/ajuda/convidar-equipe-2.png",
      },
      {
        titulo: "A pessoa aceita e cria a senha",
        texto:
          "Ao abrir o link ela cria a conta (ou entra com Google) e já cai no escritório com o cargo escolhido. Convite pendente fica listado na aba até ser aceito.",
      },
      {
        titulo: "Ajustar o que cada cargo pode em «Permissões»",
        texto:
          "Na aba «Permissões» cada cargo tem uma linha por módulo: ver tudo, ver só os próprios, criar, editar, excluir. Mudou o cargo? A pessoa vê a diferença no próximo carregamento.",
      },
    ],
    depois: [
      "A pessoa aparece na lista da Equipe com o cargo; dá pra pausar o acesso ou trocar o cargo por ali mesmo.",
      "Conversas do Atendimento podem ser distribuídas pra ela, no rodízio do departamento.",
      "Quem sai da equipe não leva histórico: cadastros e conversas continuam no escritório.",
    ],
    seNaoDeuCerto: [
      {
        titulo: "O convite não chega no e-mail",
        texto:
          "Confira a caixa de spam. Enquanto isso, copie o link do convite (aparece embaixo do formulário depois de enviar) e mande pelo WhatsApp — o link vale igual.",
      },
      {
        titulo: "Limite de usuários do plano",
        texto: "O plano tem um número de vagas. Desative quem saiu (a vaga volta) ou troque de plano em Configurações → Meu plano.",
      },
      {
        titulo: "A pessoa entrou, mas não vê o módulo",
        texto:
          "É o cargo: confira em «Permissões» se o cargo dela tem pelo menos ver os próprios naquele módulo. Módulo que o escritório não contratou não aparece pra ninguém.",
      },
    ],
    tarefasLigadas: ["conectar-whatsapp", "cadastrar-cliente", "ver-comissao-atendente"],
    abrirTela: { rota: "/configuracoes?tab=equipe", rotulo: "Configurações → Equipe" },
    arquivoTela: "client/src/pages/Configuracoes.tsx",
  },
  { id: "assinar-ou-trocar-plano", titulo: "Assinar ou trocar de plano", grupo: "Gestão", emBreve: true, palavrasChave: ["plano", "assinatura", "pagamento", "meu plano"] },
] as const satisfies readonly TarefaAjuda[];

export type TarefaId = (typeof TAREFAS_AJUDA)[number]["id"];

export function tarefaCompleta(t: TarefaAjuda): t is TarefaCompleta {
  return !t.emBreve;
}

export function tarefaPorId(id: string): TarefaAjuda | undefined {
  return TAREFAS_AJUDA.find((t) => t.id === id);
}

/**
 * Módulos que liberam a tela da tarefa (basta UM contratado) — a MESMA
 * régua do ModuloGuard sobre a rota de «Abrir a tela». É o que faz
 * "Cadastrar um cliente" abrir no pacote só-processos: /clientes vira a
 * versão essencial lá, e o `modulo: "clientes"` sozinho dizia "bloqueada".
 * Rota sem regra no guard (Configurações) cai no módulo declarado.
 */
export function modulosQueLiberam(t: TarefaCompleta): readonly string[] {
  return modulosDaRota(t.abrirTela.rota) ?? (t.modulo ? [t.modulo] : []);
}

export function tarefasDoGrupo(grupo: GrupoAjuda): readonly TarefaAjuda[] {
  return TAREFAS_AJUDA.filter((t) => t.grupo === grupo);
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Busca no título e nas palavras-chave, sem acento e sem caixa. Termo vazio = todas. */
export function buscarTarefas(termo: string): readonly TarefaAjuda[] {
  const t = normalizar(termo.trim());
  if (!t) return TAREFAS_AJUDA;
  const partes = t.split(/\s+/);
  return TAREFAS_AJUDA.filter((tarefa) => {
    const alvo = normalizar([tarefa.titulo, ...(tarefa.palavrasChave ?? [])].join(" "));
    return partes.every((p) => alvo.includes(p));
  });
}
