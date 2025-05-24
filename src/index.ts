import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { z } from "zod";

export interface InviteOptions {
  inviteDurationSeconds: number;
  generateCode?: () => string;
  getDate?: () => Date;
  signupRequiresInvite: boolean;
}

type Invite = {
  code: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export const invite = (options: InviteOptions) => {
  const opts = {
    generateCode:
      options.generateCode ?? (() => generateRandomString(6, "0-9", "A-Z")),
    getDate: options.getDate ?? (() => new Date()),
    ...options,
  };

  const ERROR_CODES = {
    USER_NOT_LOGGED_IN: "User must be logged in to create an invite",
  } as const;

  return {
    id: "invite",
    endpoints: {
      create: createAuthEndpoint(
        "/invite/create",
        {
          body: z.object({ _: z.literal(true) }),
          method: "POST",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const user = ctx.context.session?.user;
          if (!user) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.USER_NOT_LOGGED_IN,
            });
          }

          const code = opts.generateCode();
          const now = opts.getDate();
          const expiresAt = new Date(
            now.getTime() + options.inviteDurationSeconds * 1000,
          );

          await ctx.context.adapter.create({
            model: "invite",
            data: {
              code,
              invitedByUserId: user.id,
              usedByUserId: null,
              createdAt: now,
              expiresAt,
            },
          });

          return ctx.json({ code }, { status: 201 });
        },
      ),
      redeem: createAuthEndpoint(
        "/invite/redeem",
        {
          method: "POST",
          body: z.object({
            code: z.string(),
          }),
        },
        async (ctx) => {
          const code = ctx.body.code;

          const invite = await ctx.context.adapter.findOne<Invite>({
            model: "invite",
            where: [{ field: "code", value: code }],
          });

          if (!invite) {
            return ctx.redirect("/auth/signin?error=invalid_invite");
          }

          ctx.setCookie("better-auth.invite-code", code, {
            httpOnly: true,
            path: "/",
            expires: invite.expiresAt ? new Date(invite.expiresAt) : undefined,
          });

          return ctx.json({}, { status: 200 });
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: (context) => context.path.startsWith("/sign-up"),
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.path.startsWith("/sign-up")) {
              const signupRequiresInvite = options.signupRequiresInvite ?? true;
              const inviteCode = ctx.getCookie("better-auth.invite-code");

              if (inviteCode !== null) {
                // An invite code was provided, validate it
                const invite = await ctx.context.adapter.findOne<Invite>({
                  model: "invite",
                  where: [{ field: "code", value: inviteCode }],
                });

                if (
                  !invite ||
                  opts.getDate() > new Date(invite.expiresAt) ||
                  invite.usedAt !== null
                ) {
                  throw new APIError("FORBIDDEN", {
                    message: "Invalid, expired, or already used invite code.",
                  });
                }
              } else {
                // No invite code was provided
                if (signupRequiresInvite) {
                  throw new APIError("FORBIDDEN", {
                    message: "An invite code is required to sign up.",
                  });
                }
                // If signup does not require an invite, and no code was provided, proceed.
              }
            }
          }),
        },
      ],

      after: [
        {
          matcher: (context) => context.path.startsWith("/sign-up"),
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.path.startsWith("/sign-up")) {
              const user = ctx.context.session?.user;

              if (user === undefined) return;

              const inviteCode = ctx.getCookie("better-auth.invite-code");
              if (inviteCode !== null) {
                const invite = await ctx.context.adapter.findOne<Invite>({
                  model: "invite",
                  where: [{ field: "code", value: inviteCode }],
                });

                if (invite === null) return;

                await ctx.context.adapter.update({
                  model: "invite",
                  where: [{ field: "code", value: inviteCode }],
                  update: {
                    usedByUserId: user.id,
                    usedAt: opts.getDate(),
                  },
                });
              }
            }
          }),
        },
      ],
    },
    $ERROR_CODES: ERROR_CODES,
    schema: {
      invite: {
        fields: {
          code: { type: "string", unique: true },
          invitedByUserId: {
            type: "string",
            references: { model: "user", field: "id", onDelete: "set null" },
          },
          usedByUserId: {
            type: "string",
            required: false,
            references: { model: "user", field: "id", onDelete: "set null" },
          },
          createdAt: { type: "date", defaultValue: () => opts.getDate() },
          expiresAt: { type: "date", required: true },
          usedAt: { type: "date", required: false },
        },
      },
    },
  } satisfies BetterAuthPlugin;
};

export * from "./client.js";
