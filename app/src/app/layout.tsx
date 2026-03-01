import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/providers";
import { Header } from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "Expressive Lending",
  description: "Constraint-based multi-dimensional lending protocol on Monad",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black text-terminal-text font-mono antialiased min-h-screen flex flex-col">
        <Providers>
          <Header />
          <main className="flex-1 overflow-hidden">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
