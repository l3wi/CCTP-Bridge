import MessageTransmitter from "./v1/transmitterV1";
import TokenMinter from "./v1/minterV1";
import TokenMessenger from "./v1/messengerV1";
import Usdc from "./usdc";

import MessageTransmitterV2 from "./v2/transmitterV2";
import MinterV2 from "./v2/minterV2";
import MessengerV2 from "./v2/messengerV2";

const abis = {
  MessageTransmitter,
  TokenMinter,
  TokenMessenger,
  Usdc,
  MessageTransmitterV2,
  MinterV2,
  MessengerV2,
};

export default abis;
