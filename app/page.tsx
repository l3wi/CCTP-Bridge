import { ConnectButton } from "@rainbow-me/rainbowkit";
import ContentWrapper from "@/components/content";

export default function Home() {
  return (
    <main>
      <section className="relative w-full bg-center bg-cover min-h-screen">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-blue-700 to-blue-400 opacity-90 pointer-events-none"></div>

        <div className="mx-auto max-w-7xl">
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

          <div className="flex flex-col items-center px-10 pb-40 lg:pt-20 lg:flex-row">
            <div className="relative w-full max-w-2xl bg-cover  mb-8 lg:mb-0  lg:w-7/12">
              <div className="relative flex flex-col items-center justify-center w-full h-full lg:pr-24">
                <div className="flex flex-col items-start space-y-8">
                  <div className="relative">
                    <h1 className="text-5xl font-extrabold leading-tight text-gray-100 sm:text-6xl md:text-7xl">
                      Bridge USDC without the fees.
                    </h1>
                  </div>
                  <p className="text-lg text-blue-300" data-primary="blue-700">
                    {`Bridge your USDC using Circle's CCTP bridge directly, instead of paying an extra fee to another protocol
                     utilizing this free service.`}
                  </p>
                  <a
                    href="https://developers.circle.com/stablecoin/docs/cctp-getting-started"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-8 py-5 text-2xl font-medium tracking-wide text-center text-blue-500 transition duration-200 bg-white rounded-lg hover:bg-gray-100 ease"
                  >
                    Learn More
                  </a>
                </div>
              </div>
            </div>

            <div className="relative z-10 w-full max-w-xl space-y-8 lg:w-5/12">
              <div
                className="flex flex-col items-start justify-start p-6 lg:p-10 bg-white shadow-2xl rounded-xl"
                data-rounded="rounded-xl"
                data-rounded-max="rounded-full"
              >
                <ContentWrapper />
              </div>
            </div>
          </div>
        </div>
        <div className="w-full text-center">
          by{" "}
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

{
  /* // <main className="flex min-h-screen flex-col items-center justify-between p-24">
    //   <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex">
    //     <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
    //       Vanilla CCTP
    //     </span>
    //     <div className="h-auto w-auto bg-none">
    //       <ConnectButton />
    //     </div>
    //   </div>
    //   <div className="flex flex-col items-center justify-center w-full h-full">
        
    //   </div>
    //   <div></div>
    // </main> */
}
