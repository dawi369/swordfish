import Link from "next/link";
import Image from "next/image";

export default function BacktestingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden flex-col">
      <header className="sticky top-0 z-40 w-full bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="flex h-14 items-center px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center">
            <Image
              src="/swordfishLogoTransparent.png"
              alt="Swordfish Logo"
              width={40}
              height={40}
              priority
              className="h-10 w-auto opacity-90 hover:opacity-100 transition-opacity"
            />
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
