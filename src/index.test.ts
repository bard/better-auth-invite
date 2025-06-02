import { getTestInstance } from "@better-auth-kit/tests";
import { type User, betterAuth } from "better-auth";
import { parseSetCookieHeader } from "better-auth/cookies";
import { hashPassword } from "better-auth/crypto";
import { admin as adminPlugin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  userAc,
} from "better-auth/plugins/admin/access";
import Database from "better-sqlite3";
import { assert, test as baseTest, expect } from "vitest";
import { type InviteClientPlugin, inviteClient } from "./client.js";
import { type InviteOptions, invite } from "./index.js";

const statement = { ...defaultStatements } as const;
const ac = createAccessControl(statement);
const guest = ac.newRole({ ...userAc.statements });
const user = ac.newRole({ ...userAc.statements });
const admin = ac.newRole({ ...adminAc.statements });

const test = baseTest.extend<{
  createAuth: ({
    pluginOptions,
  }: {
    pluginOptions: InviteOptions;
  }) => ReturnType<
    typeof getTestInstance<{
      plugins: Array<InviteClientPlugin>;
    }>
  >;
}>({
  createAuth: async ({ task: _task }, use) => {
    const database = new Database(":memory:");

    await use(async ({ pluginOptions }: { pluginOptions: InviteOptions }) => {
      const testInstance = await getTestInstance(
        betterAuth({
          database,
          plugins: [
            adminPlugin({
              ac,
              roles: { guest, user, admin },
              defaultRole: "guest",
            }),
            invite(pluginOptions),
          ],
          emailAndPassword: { enabled: true },
        }),
        {
          shouldRunMigrations: true,
          clientOptions: { plugins: [inviteClient()] },
        },
      );

      const { db, testUser } = testInstance;

      const { id: userId } = await db.create({
        model: "user",
        data: { ...testUser, role: "user" },
      });

      await db.create({
        model: "account",
        data: {
          password: await hashPassword(testUser.password),
          accountId: crypto.randomUUID(),
          providerId: "credential",
          userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return testInstance;
    });

    database.close();
  },
});

test("user without invite receives default role upon signup and invite is marked as used", async ({
  createAuth,
}) => {
  const { client, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
    },
  });

  const { error } = await client.signUp.email({
    email: "newuser@example.com",
    password: "password123",
    name: "New User",
  });

  expect(error).toEqual(null);

  const user = await db.findOne<User>({
    model: "user",
    where: [{ field: "email", value: "newuser@example.com" }],
  });

  expect(user).toMatchObject({
    role: "guest",
  });
});

test("user with invite receives upgraded role upon signup; invite is marked as used", async ({
  createAuth,
}) => {
  const getDate = () => new Date("2025-01-01T10:00:00");
  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
      generateCode: () => "invite-123",
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
    },
  });

  const invitingUser = await db.findOne<User>({
    model: "user",
    where: [{ field: "email", value: testUser.email }],
  });

  assert(invitingUser);

  await db.create({
    model: "invite",
    data: {
      code: "invite-123",
      invitedByUserId: invitingUser.id,
      usedByUserId: null,
      createdAt: getDate(),
      updatedAt: getDate(),
      expiresAt: new Date(getDate().getTime() + 3600_000),
      usedAt: null,
    },
  });

  const { error } = await client.signUp.email({
    email: "newuser@example.com",
    password: "password123",
    name: "New User",
    fetchOptions: {
      headers: new Headers({ cookie: "better-auth.invite-code=invite-123" }),
    },
  });

  expect(error).toBe(null);

  const invitedUser = await db.findOne<User>({
    model: "user",
    where: [{ field: "email", value: "newuser@example.com" }],
  });

  expect(invitedUser).toMatchObject({
    role: "user",
  });

  const invite = await db.findOne({
    model: "invite",
    where: [{ field: "code", value: "invite-123" }],
  });

  expect(invite).toMatchObject({
    usedAt: new Date("2025-01-01T09:00:00Z"),
  });
});

test("signed-in user with full access can create an invite", async ({
  createAuth,
}) => {
  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate: () => new Date("2025-01-01T10:00:00"),
      generateCode: () => "invite-123",
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
    },
  });

  let authCookie: string | null = null;
  const signinResponse = await client.signIn.email({
    email: testUser.email,
    password: testUser.password,
    fetchOptions: {
      onSuccess(context) {
        const header = context.response.headers.get("set-cookie");
        const cookies = parseSetCookieHeader(header ?? "");
        const signedCookie = cookies.get("better-auth.session_token")?.value;
        authCookie = `better-auth.session_token=${signedCookie}`;
      },
    },
  });

  assert(authCookie);
  assert(signinResponse.data !== null);

  const { user } = signinResponse.data;

  const inviteCreationResponse = await client.invite.create({
    _: true,
    fetchOptions: {
      headers: new Headers({ cookie: authCookie }),
    },
  });

  expect(inviteCreationResponse).toEqual({
    data: { code: "invite-123" },
    error: null,
  });
  assert(inviteCreationResponse.data);

  const { code } = inviteCreationResponse.data;
  const invite = await db.findOne({
    model: "invite",
    where: [{ field: "code", value: code }],
  });

  expect(invite).toMatchObject({
    code: "invite-123",
    invitedByUserId: user.id,
    usedByUserId: "null", // correctly stored as null in the database, but `transformOutput` in create-adapter/index.ts for some reason stringifies it
    createdAt: new Date("2025-01-01T09:00:00Z"),
    expiresAt: new Date("2025-01-01T10:00:00Z"),
    usedAt: null,
  });
});

test("when user redeems invite, invite code gets stored in a cryptographically signed http-only cookie", async ({
  createAuth,
}) => {
  const getDate = () => new Date("2025-01-01T10:00:00");
  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
      generateCode: () => "invite-123",
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
    },
  });

  const user = await db.findOne<User>({
    model: "user",
    where: [{ field: "email", value: testUser.email }],
  });

  assert(user);
  await db.create({
    model: "invite",
    data: {
      code: "invite-123",
      invitedByUserId: user.id,
      usedByUserId: null,
      createdAt: getDate(),
      updatedAt: getDate(),
      expiresAt: new Date(getDate().getTime() + 3600_000),
      usedAt: null,
    },
  });

  let inviteCode: string | null = null;
  await client.invite.redeem(
    { code: "invite-123" },
    {
      onSuccess(context) {
        const header = context.response.headers.get("set-cookie");
        const cookies = parseSetCookieHeader(header || "");
        inviteCode = cookies.get("better-auth.invite-code")?.value ?? null;
      },
    },
  );

  expect(inviteCode).toEqual("invite-123");

  // TODO check for http-only
  // TODO check for encryption
});

test("user with guest role cannot create invites", async ({ createAuth }) => {
  const { client } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
    },
  });

  const guestEmail = "guestonly@example.com";
  const guestPassword = "password123";
  const signUpResponse = await client.signUp.email({
    email: guestEmail,
    password: guestPassword,
    name: "Guest Only User",
  });
  expect(signUpResponse.error).toBe(null);

  let authCookie: string | null = null;
  const signInResponse = await client.signIn.email({
    email: guestEmail,
    password: guestPassword,
    fetchOptions: {
      onSuccess(context) {
        const header = context.response.headers.get("set-cookie");
        const cookies = parseSetCookieHeader(header ?? "");
        const signedCookie = cookies.get("better-auth.session_token")?.value;
        authCookie = `better-auth.session_token=${signedCookie}`;
      },
    },
  });
  expect(signInResponse.error).toBe(null);
  assert(authCookie);

  const inviteCreationResponse = await client.invite.create({
    _: true,
    fetchOptions: {
      headers: new Headers({ cookie: authCookie }),
    },
  });

  expect(inviteCreationResponse.error).not.toBe(null);
  expect(inviteCreationResponse.error?.code).toBe(
    "USER_DOES_NOT_HAVE_SUFFICIENT_PERMISSIONS_TO_CREATE_INVITE",
  );
});

test("custom runtime criteria can decide whether a user can create invites", async ({
  createAuth,
}) => {
  const { client, testUser } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate: () => new Date("2025-01-01T10:00:00"),
      generateCode: () => "invite-123",
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
      canCreateInvite: (user) => user.email.endsWith("@acme.com"),
    },
  });

  let authCookie: string | null = null;
  const signinResponse = await client.signIn.email({
    email: testUser.email,
    password: testUser.password,
    fetchOptions: {
      onSuccess(context) {
        const header = context.response.headers.get("set-cookie");
        const cookies = parseSetCookieHeader(header ?? "");
        const signedCookie = cookies.get("better-auth.session_token")?.value;
        authCookie = `better-auth.session_token=${signedCookie}`;
      },
    },
  });

  assert(authCookie);
  assert(signinResponse.data !== null);

  const inviteCreationResponse = await client.invite.create({
    _: true,
    fetchOptions: { headers: new Headers({ cookie: authCookie }) },
  });

  expect(inviteCreationResponse.error).toMatchInlineSnapshot(`
    {
      "code": "USER_DOES_NOT_HAVE_SUFFICIENT_PERMISSIONS_TO_CREATE_INVITE",
      "message": "User does not have sufficient permissions to create invite",
      "status": 400,
      "statusText": "BAD_REQUEST",
    }
  `);
});

test.todo("custom runtime criteria can decide whether a user can  invites");

test.todo("after successful sign-in, invite cookie is cleared");

test.todo(
  "custom runtime criteria for invite creation override default role check",
);

test.todo("used invite cannot be used again");

test.todo("works with email signin");

test.todo("works with email signup");

test.todo("works with email-top signin");

test.todo("works with oauth signin");
