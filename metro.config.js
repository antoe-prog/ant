const path = require("path");
const Module = require("module");

// Help packages loaded from pnpm's virtual store resolve project-local deps
// such as tailwindcss during EAS CLI preflight.
process.env.NODE_PATH = [
  path.resolve(__dirname, "node_modules"),
  process.env.NODE_PATH || "",
]
  .filter(Boolean)
  .join(path.delimiter);
Module._initPaths();

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// expo-server-sdk는 서버 전용 패키지 - Metro 감시 대상에서 제외
config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...(config.resolver?.extraNodeModules || {}),
    react: path.resolve(__dirname, "node_modules/react"),
    "react-native": path.resolve(__dirname, "node_modules/react-native"),
    nativewind: path.resolve(__dirname, "node_modules/nativewind"),
    tailwindcss: path.resolve(__dirname, "node_modules/tailwindcss"),
    "expo-router": path.resolve(__dirname, "node_modules/expo-router"),
    "@expo/metro-runtime": path.resolve(
      __dirname,
      "node_modules/@expo/metro-runtime",
    ),
    "react-native-css-interop": path.resolve(
      __dirname,
      "node_modules/react-native-css-interop",
    ),
  },
  blockList: [
    ...(Array.isArray(config.resolver?.blockList) ? config.resolver.blockList : []),
    /.*expo-server-sdk_tmp.*/,
  ],
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});
