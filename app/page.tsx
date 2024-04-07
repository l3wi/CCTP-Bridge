import { ConnectButton } from "@rainbow-me/rainbowkit";
import ContentWrapper from "@/components/content";

export default function Home() {
  return (
    <main className="inset-0 bg-gradient-to-br from-blue-900 via-blue-700 to-blue-400 opacity-90">
      <section className="relative w-full bg-center bg-cover min-h-screen flex flex-col">
        <div className="mx-auto flex-grow max-w-7xl w-full">
          <div className="relative flex items-center justify-between h-24 px-10">
            <a
              href="#_"
              className="flex items-center mb-4 font-medium text-gray-100 lg:order-none lg:w-auto lg:items-center lg:justify-center md:mb-0"
            >
              <span className="text-2xl font-black leading-none text-gray-100 select-none logo"></span>
            </a>

            <span className="block">
              <ConnectButton />
            </span>
          </div>

          <ContentWrapper />
        </div>
        <div className="w-full text-center text-xs text-slate-200 mt-5 py-2 bg-slate-900/50">
          {`built by `}
          <a
            href="https://twitter.com/lewifree"
            target="_blank"
            rel="noopener noreferrer"
          >
            lewi
          </a>
        </div>
      </section>
    </main>
  );
}
