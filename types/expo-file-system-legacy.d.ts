declare module "expo-file-system/legacy" {
  export const documentDirectory: string | null;

  export const EncodingType: {
    readonly UTF8: string;
    readonly Base64: string;
  };

  export function writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: {
      encoding?: string;
    }
  ): Promise<void>;
}
