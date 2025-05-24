import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { z } from "zod";
export const invite = (options) => {
  const idGenerator =
    options.generateId ?? (() => generateRandomString(6, "0-9", "A-Z"));
  const getDate = options.getDate ?? (() => new Date());
  const ERROR_CODES = {
    USER_NOT_LOGGED_IN: "User must be logged in to create an invite",
  };
  return {
    id: "invite",
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
          createdAt: { type: "date", defaultValue: () => getDate() },
          expiresAt: { type: "date", required: true },
          usedAt: { type: "date", required: false },
        },
      },
    },
    endpoints: {
      createInvite: createAuthEndpoint(
        "/invite/create",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const user = ctx.context.session?.user;
          if (!user) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.USER_NOT_LOGGED_IN,
            });
          }
          const code = idGenerator();
          const now = getDate();
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
      redeemInviteCode: createAuthEndpoint(
        "/invite/redeem",
        {
          method: "POST",
          body: z.object({
            code: z.string(),
          }),
        },
        async (ctx) => {
          const code = ctx.body.code;
          const invite = await ctx.context.adapter.findOne({
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
                const invite = await ctx.context.adapter.findOne({
                  model: "invite",
                  where: [{ field: "code", value: inviteCode }],
                });
                if (
                  !invite ||
                  getDate() > new Date(invite.expiresAt) ||
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
                const invite = await ctx.context.adapter.findOne({
                  model: "invite",
                  where: [{ field: "code", value: inviteCode }],
                });
                if (invite === null) return;
                await ctx.context.adapter.update({
                  model: "invite",
                  where: [{ field: "code", value: inviteCode }],
                  update: {
                    usedByUserId: user.id,
                    usedAt: getDate(),
                  },
                });
              }
            }
          }),
        },
      ],
    },
  };
};
export * from "./client.js";
