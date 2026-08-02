import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spidey Network — La ciudad está en línea",
  description: "Una experiencia fan interactiva con misiones, expedientes de amenazas y un rastreador global de avistamientos.",
  openGraph: {
    title: "Spidey Network",
    description: "La ciudad está en línea. Explora misiones, amenazas y señales en el rastreador global.",
    images: ["https://spidey-trace-queens.crstian-tercero.chatgpt.site/hero-command.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Spidey Network",
    description: "La ciudad está en línea. Explora misiones, amenazas y señales en el rastreador global.",
    images: ["https://spidey-trace-queens.crstian-tercero.chatgpt.site/hero-command.png"],
  },
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="es"><body>{children}</body></html>}
