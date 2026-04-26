declare module "react-native-svg" {
  import type { ComponentType } from "react";

  const Svg: ComponentType<any>;
  export default Svg;

  export const Rect: ComponentType<any>;
  export const Text: ComponentType<any>;
  export const Line: ComponentType<any>;
  export const Circle: ComponentType<any>;
  export const Polyline: ComponentType<any>;
}

declare module "expo-camera" {
  import type { ComponentType } from "react";

  export const CameraView: ComponentType<any>;
  export function useCameraPermissions(): [any, () => Promise<any>];
}

declare module "react-native-gesture-handler" {
  import type { ComponentType } from "react";

  export const GestureHandlerRootView: ComponentType<any>;
  export class Swipeable extends (class {} as { new (...args: any[]): any }) {}
}
