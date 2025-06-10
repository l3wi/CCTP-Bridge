import MessageTransmitter from "./v1/transmitterV1";
import TokenMinter from "./v1/minterV1";
import TokenMessenger from "./v1/messengerV1";
import Usdc from "./usdc";

import MessageTransmitterV2 from "./v2/transmitterV2";
import TokenMinterV2 from "./v2/minterV2";
import TokenMessengerV2 from "./v2/tokenMessengerV2";

const abis = {
  // V1 ABIs
  MessageTransmitter,
  TokenMinter,
  TokenMessenger,
  Usdc,
  // V2 ABIs
  MessageTransmitterV2,
  TokenMinterV2,
  TokenMessengerV2,
};

// Helper function to get the correct ABI based on version
const getABI = (
  contractType:
    | "TokenMessenger"
    | "MessageTransmitter"
    | "TokenMinter"
    | "Usdc",
  version: "v1" | "v2" = "v1"
) => {
  if (version === "v2") {
    switch (contractType) {
      case "TokenMessenger":
        return abis.TokenMessengerV2;
      case "MessageTransmitter":
        return abis.MessageTransmitterV2;
      case "TokenMinter":
        return abis.TokenMinterV2;
      case "Usdc":
        return abis.Usdc; // USDC ABI is the same for both versions
    }
  }

  // Default to V1
  switch (contractType) {
    case "TokenMessenger":
      return abis.TokenMessenger;
    case "MessageTransmitter":
      return abis.MessageTransmitter;
    case "TokenMinter":
      return abis.TokenMinter;
    case "Usdc":
      return abis.Usdc;
  }
};
export { getABI };
export default abis;
