import type { z } from "zod";
export interface InviteOptions {
  inviteDurationSeconds: number;
  generateId?: () => string;
  getDate?: () => Date;
  signupRequiresInvite?: boolean;
}
export declare const invite: (options: InviteOptions) => {
  id: "invite";
  $ERROR_CODES: {
    readonly USER_NOT_LOGGED_IN: "User must be logged in to create an invite";
  };
  schema: {
    invite: {
      fields: {
        code: {
          type: "string";
          unique: true;
        };
        invitedByUserId: {
          type: "string";
          references: {
            model: string;
            field: string;
            onDelete: "set null";
          };
        };
        usedByUserId: {
          type: "string";
          required: false;
          references: {
            model: string;
            field: string;
            onDelete: "set null";
          };
        };
        createdAt: {
          type: "date";
          defaultValue: () => Date;
        };
        expiresAt: {
          type: "date";
          required: true;
        };
        usedAt: {
          type: "date";
          required: false;
        };
      };
    };
  };
  endpoints: {
    createInvite: {
      <
        AsResponse extends boolean = false,
        ReturnHeaders extends boolean = false,
      >(
        inputCtx_0?:
          | ({
              body?: undefined;
            } & {
              method?: "POST" | undefined;
            } & {
              query?: Record<string, any> | undefined;
            } & {
              params?: Record<string, any>;
            } & {
              request?: Request;
            } & {
              headers?: HeadersInit;
            } & {
              asResponse?: boolean;
              returnHeaders?: boolean;
              use?: import("better-auth").Middleware[];
              path?: string;
            } & {
              asResponse?: AsResponse | undefined;
              returnHeaders?: ReturnHeaders | undefined;
            })
          | undefined,
      ): Promise<
        [AsResponse] extends [true]
          ? Response
          : [ReturnHeaders] extends [true]
            ? {
                headers: Headers;
                response: {
                  code: string;
                };
              }
            : {
                code: string;
              }
      >;
      options: {
        method: "POST";
        use: ((
          inputContext: import("better-auth").MiddlewareInputContext<
            import("better-auth").MiddlewareOptions
          >,
        ) => Promise<{
          session: {
            session: Record<string, any> & {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              userId: string;
              expiresAt: Date;
              token: string;
              ipAddress?: string | null | undefined;
              userAgent?: string | null | undefined;
            };
            user: Record<string, any> & {
              id: string;
              name: string;
              email: string;
              emailVerified: boolean;
              createdAt: Date;
              updatedAt: Date;
              image?: string | null | undefined;
            };
          };
        }>)[];
      } & {
        use: any[];
      };
      path: "/invite/create";
    };
    redeemInviteCode: {
      <
        AsResponse extends boolean = false,
        ReturnHeaders extends boolean = false,
      >(
        inputCtx_0: {
          body: {
            code: string;
          };
        } & {
          method?: "POST" | undefined;
        } & {
          query?: Record<string, any> | undefined;
        } & {
          params?: Record<string, any>;
        } & {
          request?: Request;
        } & {
          headers?: HeadersInit;
        } & {
          asResponse?: boolean;
          returnHeaders?: boolean;
          use?: import("better-auth").Middleware[];
          path?: string;
        } & {
          asResponse?: AsResponse | undefined;
          returnHeaders?: ReturnHeaders | undefined;
        },
      ): Promise<
        [AsResponse] extends [true]
          ? Response
          : [ReturnHeaders] extends [true]
            ? {
                headers: Headers;
                response: {};
              }
            : {}
      >;
      options: {
        method: "POST";
        body: z.ZodObject<
          {
            code: z.ZodString;
          },
          "strip",
          z.ZodTypeAny,
          {
            code: string;
          },
          {
            code: string;
          }
        >;
      } & {
        use: any[];
      };
      path: "/invite/redeem";
    };
  };
  hooks: {
    before: {
      matcher: (context: import("better-auth").HookEndpointContext) => boolean;
      handler: (
        inputContext: import("better-auth").MiddlewareInputContext<
          import("better-auth").MiddlewareOptions
        >,
      ) => Promise<void>;
    }[];
    after: {
      matcher: (context: import("better-auth").HookEndpointContext) => boolean;
      handler: (
        inputContext: import("better-auth").MiddlewareInputContext<
          import("better-auth").MiddlewareOptions
        >,
      ) => Promise<void>;
    }[];
  };
};
export * from "./client.js";
