export interface Job {
  deliveryId: string;
  eventType: string;
  repository?: {
    owner?: {
      login: string;
    };
    name: string;
  };
  env?: Record<string, string>;
  [key: string]: any;
}
