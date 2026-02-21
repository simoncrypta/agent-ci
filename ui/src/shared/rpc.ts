export type MyRPCSchema = {
  bun: {
    requests: {
      launchDTU: {
        params: void;
        response: boolean;
      };
      stopDTU: {
        params: void;
        response: boolean;
      };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {
      dtuLog: string;
    };
  };
};
