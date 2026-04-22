const isProduction = process.env.NODE_ENV === "production";

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    if (isProduction) {
      throw new Error(`[ENV] Variável de ambiente obrigatória não definida: ${name}`);
    }
    console.warn(`[ENV] AVISO: ${name} não definida. Defina antes de ir para produção.`);
    return "";
  }
  return value;
}

export const ENV = {
  // appId é usado como audience do JWT de sessão. Default "jurify" pra
  // funcionar sem precisar definir VITE_APP_ID no servidor.
  appId: process.env.VITE_APP_ID || "jurify",
  cookieSecret: requireEnv("JWT_SECRET", process.env.JWT_SECRET),
  databaseUrl: requireEnv("DATABASE_URL", process.env.DATABASE_URL),
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
};
