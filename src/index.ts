import type { BetterAuthPlugin } from "better-auth";
import {
  createAuthEndpoint,
  createAuthMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import type { UserWithRole } from "better-auth/plugins";
import { z } from "zod";

export interface InviteOptions {
  inviteDurationSeconds: number;
  roleForSignupWithoutInvite: string;
  roleForSignupWithInvite: string;
  canCreateInvite?: (user: UserWithRole) => boolean;
  generateCode?: () => string;
  getDate?: () => Date;
}

type Invite = {
  id: string;
  code: string;
  maxUses: number;
  expiresAt: Date;
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
    INSUFFICIENT_PERMISSIONS:
      "User does not have sufficient permissions to create invite",
    NO_SUCH_USER: "No such user",
    NO_USES_LEFT_FOR_INVITE_CODE: "No uses left for invite code",
    INVALID_OR_EXPIRED_INVITE: "Invalid or expired invite code",
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
          const userId = ctx.context.session?.user?.id;
          if (userId === undefined) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.USER_NOT_LOGGED_IN,
            });
          }

          const user = await ctx.context.internalAdapter.findUserById(userId);

          if (user === null) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.NO_SUCH_USER,
            });
          }

          let canCreateInvite: boolean;
          if (options.canCreateInvite !== undefined) {
            canCreateInvite = options.canCreateInvite(user);
          } else {
            const isGuest =
              user !== null &&
              "role" in user &&
              typeof user.role === "string" &&
              user.role === options.roleForSignupWithoutInvite;

            canCreateInvite = !isGuest;
          }

          if (!canCreateInvite) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.INSUFFICIENT_PERMISSIONS,
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
              createdByUserId: user.id,
              createdAt: now,
              expiresAt,
              maxUses: 1,
            },
          });

          return ctx.json({ code }, { status: 201 });
        },
      ),
      activate: createAuthEndpoint(
        "/invite/activate",
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

          if (invite === null) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.INVALID_OR_EXPIRED_INVITE,
            });
          }

          const timesUsed = await ctx.context.adapter.count({
            model: "invite_use",
            where: [{ field: "inviteId", value: invite.id }],
          });

          if (!(timesUsed < invite.maxUses)) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.NO_USES_LEFT_FOR_INVITE_CODE,
            });
          }

          if (opts.getDate() > invite.expiresAt) {
            throw ctx.error("BAD_REQUEST", {
              message: ERROR_CODES.INVALID_OR_EXPIRED_INVITE,
            });
          }

          ctx.setCookie("better-auth.invite-code", code, {
            httpOnly: true,
            path: "/",
            expires: invite.expiresAt,
          });

          return ctx.json({}, { status: 200 });
        },
      ),
    },
    hooks: {
      after: [
        {
          matcher: (context) =>
            context.path === "/sign-up/email" ||
            context.path === "/sign-in/email" ||
            context.path === "/sign-in/email-otp" ||
            // For social logins, newSession is not available at the end of the initial /sign-in call
            context.path === "/callback/:id",

          handler: createAuthMiddleware(async (ctx) => {
            const validation = z
              .object({
                user: z.object({ id: z.string() }),
              })
              .safeParse(ctx.context.newSession);

            if (!validation.success) {
              return;
            }

            const {
              user: { id: userId },
            } = validation.data;

            const user = await ctx.context.internalAdapter.findUserById(userId);

            const isGuest =
              user !== null &&
              "role" in user &&
              typeof user.role === "string" &&
              user.role === options.roleForSignupWithoutInvite;

            if (!isGuest) {
              return;
            }

            const inviteCode = ctx.getCookie("better-auth.invite-code");

            if (inviteCode === null) {
              return;
            }

            const invite = await ctx.context.adapter.findOne<Invite>({
              model: "invite",
              where: [{ field: "code", value: inviteCode }],
            });

            if (invite === null) {
              return;
            }

            if (invite.expiresAt < opts.getDate()) {
              // TODO should throw error?
              return;
            }

            const timesUsed = await ctx.context.adapter.count({
              model: "invite_use",
              where: [{ field: "inviteId", value: invite.id }],
            });

            if (!(timesUsed < invite.maxUses)) {
              throw ctx.error("BAD_REQUEST", {
                message: ERROR_CODES.NO_USES_LEFT_FOR_INVITE_CODE,
              });
            }

            await ctx.context.adapter.update({
              model: "user",
              where: [{ field: "id", value: userId }],
              update: { role: options.roleForSignupWithInvite },
            });

            const usageDate = opts.getDate();

            await ctx.context.adapter.create({
              model: "invite_use",
              data: {
                inviteId: invite.id,
                usedByUserId: userId,
                usedAt: usageDate,
              },
            });

            ctx.setCookie("better-auth.invite-code", "", {
              path: "/",
              httpOnly: true,
              expires: new Date(0), // Set to epoch to clear
            });
          }),
        },
      ],
    },
    $ERROR_CODES: ERROR_CODES,
    schema: {
      invite: {
        fields: {
          code: { type: "string", unique: true },
          createdAt: { type: "date", defaultValue: () => opts.getDate() },
          expiresAt: { type: "date", required: true },
          maxUses: { type: "number", required: true },
          createdByUserId: {
            type: "string",
            references: { model: "user", field: "id", onDelete: "set null" },
          },
        },
      },
      invite_use: {
        fields: {
          inviteId: {
            type: "string",
            required: true,
            references: { model: "invite", field: "id", onDelete: "set null" },
          },
          usedAt: { type: "date", required: true },
          usedByUserId: {
            type: "string",
            required: false,
            references: { model: "user", field: "id", onDelete: "set null" },
          },
        },
      },
    },
  } satisfies BetterAuthPlugin;
};

export * from "./client.js";
