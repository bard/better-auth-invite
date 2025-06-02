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
    INSUFFICIENT_PERMISSIONS:
      "User does not have sufficient permissions to create invite",
    NO_SUCH_USER: "No such user",
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

            // Additional check: ensure invite is not already used
            if (invite.usedAt !== null) {
              return;
            }

            // Additional check: ensure invite is not expired
            if (invite.expiresAt.getTime() < opts.getDate().getTime()) {
              return;
            }

            await ctx.context.adapter.update({
              model: "user",
              where: [{ field: "id", value: userId }],
              update: { role: options.roleForSignupWithInvite },
            });

            const usageDate = opts.getDate();
            await ctx.context.adapter.update({
              model: "invite",
              where: [{ field: "code", value: inviteCode }],
              update: {
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
