import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * Toasts no canto superior direito.
 *
 * Ficavam embaixo à esquerda, ou seja, em cima do menu — tapavam justo os
 * itens de navegação. À direita eles caem sobre a área de conteúdo, onde
 * atrapalham menos e ficam no campo de visão de quem acabou de agir.
 *
 * O tema vem do ThemeContext do app (antes vinha do `next-themes`, que
 * nunca teve provider aqui: o sonner seguia o SO, não o app).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { tema } = useTheme();

  return (
    <Sonner
      theme={tema === "escuro" ? "dark" : "light"}
      className="toaster group"
      position="top-right"
      visibleToasts={3}
      gap={10}
      offset={{ top: "16px", right: "16px" }}
      style={
        {
          "--width": "308px",
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
