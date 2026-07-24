export type JsonSchema = {
  $id: string;
  type: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, unknown>;
  items?: unknown;
  enum?: string[];
};
