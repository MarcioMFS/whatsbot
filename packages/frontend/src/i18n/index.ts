export type Locale = 'en' | 'pt-BR'

export const translations = {
  en: {
    // Nav
    dashboard: 'Dashboard',
    signOut: 'Sign out',

    // Dashboard
    yourBots: 'Your Bots',
    manageBotsDesc: 'Manage your WhatsApp automation bots',
    newBot: 'New Bot',
    active: 'Active',
    inactive: 'Inactive',
    noBots: 'No bots yet',
    noBotsDesc: 'Create your first WhatsApp bot with AI-powered responses and visual conversation flows.',
    createFirstBot: 'Create your first bot',

    // Bot card
    aiProvider: 'AI',
    instance: 'Instance',

    // Bot config
    botInfo: 'Bot Info',
    model: 'Model',
    temperature: 'Temperature',
    language: 'Language',
    whatsappConnection: 'WhatsApp Connection',
    scanQR: 'Scan the QR code to connect your WhatsApp number to this bot.',
    showQRCode: 'Show QR Code',
    conversationFlows: 'Conversation Flows',
    newFlow: 'New Flow',
    flowName: 'Flow name:',
    nodes: 'nodes',
    connections: 'connections',
    activate: 'Activate',
    deactivate: 'Deactivate',
    edit: 'Edit',

    // Flow builder
    save: 'Save',
    saving: 'Saving...',

    // Create bot modal
    createYourBot: 'Create your bot',
    reviewYourBot: 'Review your bot',
    describeProduct: 'Describe your product — AI does the rest',
    aiGenerated: 'AI generated this for you',
    chooseProvider: 'AI Provider',
    groqFaster: '⚡ Groq (faster)',
    whatDoesProductDo: 'What does your product or service do?',
    descriptionPlaceholder: 'Example:\n\nWe sell handmade artisan coffee beans sourced from Brazil and Colombia. We have a subscription plan and one-time purchase options.',
    orUploadFile: 'Or upload a text/PDF file',
    uploadNote: 'Supported: .txt, .md, .csv (PDF → copy/paste the text for now)',
    botLanguage: 'Bot language',
    generating: 'Generating your bot...',
    generateWithAI: 'Generate bot with AI',
    describeFirst: 'Describe your product first.',
    aiGenerationFailed: 'AI generation failed',
    botName: 'Bot name',
    whatsappInstance: 'WhatsApp instance name',
    instanceNote: 'A unique ID for the WhatsApp connection. Letters, numbers, hyphens only.',
    persona: 'Persona',
    welcomeMessage: 'Welcome message',
    suggestedFlow: 'Suggested conversation flow',
    viewEditPrompt: 'View & edit system prompt',
    hidePrompt: 'Hide system prompt',
    changeDescription: 'Change description and regenerate',
    creatingBot: 'Creating bot...',
    createBot: 'Create bot',
    cancel: 'Cancel',
    back: 'Back',
    failedCreate: 'Failed to create bot',

    // Login
    welcomeBack: 'Welcome back',
    createAccount: 'Create account',
    aiPowered: 'AI-powered WhatsApp automation',
    name: 'Name',
    yourName: 'Your name',
    email: 'Email',
    password: 'Password',
    loading: 'Loading...',
    signIn: 'Sign in',
    signUp: 'Sign up',
    noAccount: "Don't have an account?",
    alreadyAccount: 'Already have an account?',
  },

  'pt-BR': {
    // Nav
    dashboard: 'Painel',
    signOut: 'Sair',

    // Dashboard
    yourBots: 'Seus Bots',
    manageBotsDesc: 'Gerencie seus bots de automação no WhatsApp',
    newBot: 'Novo Bot',
    active: 'Ativo',
    inactive: 'Inativo',
    noBots: 'Nenhum bot ainda',
    noBotsDesc: 'Crie seu primeiro bot para WhatsApp com respostas com IA e fluxos de conversa visuais.',
    createFirstBot: 'Criar meu primeiro bot',

    // Bot card
    aiProvider: 'IA',
    instance: 'Instância',

    // Bot config
    botInfo: 'Info do Bot',
    model: 'Modelo',
    temperature: 'Temperatura',
    language: 'Idioma',
    whatsappConnection: 'Conexão WhatsApp',
    scanQR: 'Escaneie o QR code para conectar seu número do WhatsApp a este bot.',
    showQRCode: 'Ver QR Code',
    conversationFlows: 'Fluxos de Conversa',
    newFlow: 'Novo Fluxo',
    flowName: 'Nome do fluxo:',
    nodes: 'nós',
    connections: 'conexões',
    activate: 'Ativar',
    deactivate: 'Desativar',
    edit: 'Editar',

    // Flow builder
    save: 'Salvar',
    saving: 'Salvando...',

    // Create bot modal
    createYourBot: 'Criar seu bot',
    reviewYourBot: 'Revisar seu bot',
    describeProduct: 'Descreva seu produto — a IA faz o resto',
    aiGenerated: 'A IA gerou isso para você',
    chooseProvider: 'Provedor de IA',
    groqFaster: '⚡ Groq (mais rápido)',
    whatDoesProductDo: 'O que seu produto ou serviço faz?',
    descriptionPlaceholder: 'Exemplo:\n\nVendemos café artesanal feito à mão do Brasil e Colômbia. Temos planos de assinatura e compra avulsa.',
    orUploadFile: 'Ou envie um arquivo de texto/PDF',
    uploadNote: 'Suportado: .txt, .md, .csv (PDF → cole o texto por enquanto)',
    botLanguage: 'Idioma do bot',
    generating: 'Gerando seu bot...',
    generateWithAI: 'Gerar bot com IA',
    describeFirst: 'Descreva seu produto primeiro.',
    aiGenerationFailed: 'Falha na geração com IA',
    botName: 'Nome do bot',
    whatsappInstance: 'Nome da instância WhatsApp',
    instanceNote: 'ID único para a conexão. Apenas letras, números e hífens.',
    persona: 'Persona',
    welcomeMessage: 'Mensagem de boas-vindas',
    suggestedFlow: 'Fluxo de conversa sugerido',
    viewEditPrompt: 'Ver e editar prompt do sistema',
    hidePrompt: 'Ocultar prompt do sistema',
    changeDescription: 'Alterar descrição e regenerar',
    creatingBot: 'Criando bot...',
    createBot: 'Criar bot',
    cancel: 'Cancelar',
    back: 'Voltar',
    failedCreate: 'Falha ao criar bot',

    // Login
    welcomeBack: 'Bem-vindo de volta',
    createAccount: 'Criar conta',
    aiPowered: 'Automação WhatsApp com IA',
    name: 'Nome',
    yourName: 'Seu nome',
    email: 'E-mail',
    password: 'Senha',
    loading: 'Carregando...',
    signIn: 'Entrar',
    signUp: 'Criar conta',
    noAccount: 'Não tem uma conta?',
    alreadyAccount: 'Já tem uma conta?',
  },
} satisfies Record<Locale, Record<string, string>>

export type TranslationKey = keyof typeof translations.en
