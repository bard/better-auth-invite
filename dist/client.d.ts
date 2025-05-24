import type { invite } from "./index.js";
export declare const inviteClient: () => {
  id: "invite-client";
  $InferServerPlugin: ReturnType<typeof invite>;
};
export type InviteClientPlugin = ReturnType<typeof inviteClient>;
