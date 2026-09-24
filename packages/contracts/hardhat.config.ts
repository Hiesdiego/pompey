import "dotenv/config";
import { defineConfig, configVariable } from "hardhat/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Local ephemeral network for fast iteration
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // Base Sepolia — TICKR v0.1 primary deployment target
    baseSepolia: {
      type: "http",
      chainType: "generic",
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("BASE_SEPOLIA_PRIVATE_KEY")],
    },
    // Base mainnet — reserved for post-beta production launch
    base: {
      type: "http",
      chainType: "generic",
      url: configVariable("BASE_MAINNET_RPC_URL"),
      accounts: [configVariable("BASE_MAINNET_PRIVATE_KEY")],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("BASESCAN_API_KEY"),
    },
  },
});
