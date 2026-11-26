declare module "mammoth" {
  export interface MammothImage {
    contentType: string;
    readAsArrayBuffer: () => Promise<ArrayBuffer>;
    readAsBase64String: () => Promise<string>;
    readAsBuffer: () => Promise<Buffer>;
  }

  export interface MammothImageConverter {
    __mammothBrand: "ImageConverter";
  }

  export interface MammothMessage {
    type: "warning" | "error";
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export interface MammothOptions {
    styleMap?: string | string[];
    includeEmbeddedStyleMap?: boolean;
    includeDefaultStyleMap?: boolean;
    convertImage?: MammothImageConverter;
    ignoreEmptyParagraphs?: boolean;
  }

  const mammoth: {
    convertToHtml: (
      input: { buffer: Buffer } | { arrayBuffer: ArrayBuffer },
      options?: MammothOptions
    ) => Promise<MammothResult>;
    images: {
      imgElement: (
        fn: (image: MammothImage) => Promise<{ src: string; alt?: string }>
      ) => MammothImageConverter;
    };
  };

  export default mammoth;
}
