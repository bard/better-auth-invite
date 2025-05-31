import type { BetterAuthClientPlugin } from "better-auth";
import type { invite } from "./index.js";

export const inviteClient = () => {
  return {
    id: "invite",
    $InferServerPlugin: {} as ReturnType<typeof invite>,
  } satisfies BetterAuthClientPlugin;
};

export type InviteClientPlugin = ReturnType<typeof inviteClient>;
