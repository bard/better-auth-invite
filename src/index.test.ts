import { getTestInstance } from "@better-auth-kit/tests";
import { type User, betterAuth } from "better-auth";
import { parseSetCookieHeader } from "better-auth/cookies";
import { generateRandomString, hashPassword } from "better-auth/crypto";
import { admin as adminPlugin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  userAc,
} from "better-auth/plugins/admin/access";
import Database from "better-sqlite3";
import { assert, test as baseTest, expect, vi } from "vitest";
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
    advancedOptions,
  }: {
    pluginOptions: InviteOptions;
    advancedOptions?: { database: { generateId: () => string } };
  }) => ReturnType<
    typeof getTestInstance<{
      plugins: Array<InviteClientPlugin>;
    }>
  >;
}>({
  createAuth: async ({ task: _task }, use) => {
    const database = new Database(":memory:");

    await use(
      async ({
        pluginOptions,
        advancedOptions,
      }: {
        pluginOptions: InviteOptions;
        advancedOptions?: { database: { generateId: () => string } };
      }) => {
        const auth = betterAuth({
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
          advanced: advancedOptions,
        });

        const testInstance = await getTestInstance(auth, {
          shouldRunMigrations: true,
          clientOptions: { plugins: [inviteClient()] },
        });

        const { db, testUser } = testInstance;

        const { id: userId } = await db.create({
          model: "user",
          data: { ...testUser, role: "user" },
        });

        await db.create({
          model: "account",
          data: {
            password: await hashPassword(testUser.password),
            accountId: generateRandomString(16),
            providerId: "credential",
            userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        return testInstance;
      },
    );

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

test("user signing up with active and valid invite receives upgraded role", async ({
  createAuth,
}) => {
  const getDate = vi
    .fn()
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00Z"))
    .mockReturnValueOnce(new Date("2025-01-01T10:01:00Z"));

  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
      generateCode: () => "invite-123",
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
    },
  });

  // biome-ignore lint/suspicious/noExplicitAny:
  const invitingUser = await db.findOne<any>({
    model: "user",
    where: [{ field: "email", value: testUser.email }],
  });

  await db.create({
    model: "invite",
    data: {
      code: "invite-123",
      createdByUserId: invitingUser.id,
      maxUses: 1,
      createdAt: new Date("2025-01-01T10:00:00.000Z"),
      updatedAt: new Date("2025-01-01T10:00:00.000Z"),
      expiresAt: new Date("2025-01-01T23:59:00.000Z"),
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

  // biome-ignore lint/suspicious/noExplicitAny:
  const invitedUser = await db.findOne<any>({
    model: "user",
    where: [{ field: "email", value: "newuser@example.com" }],
  });

  expect(invitedUser).toMatchObject({
    role: "user",
  });

  // biome-ignore lint/suspicious/noExplicitAny:
  const invite = await db.findOne<any>({
    model: "invite",
    where: [{ field: "code", value: "invite-123" }],
  });

  expect(invite).toMatchObject({
    code: "invite-123",
    createdAt: new Date("2025-01-01T10:00:00.000Z"),
    expiresAt: new Date("2025-01-01T23:59:00.000Z"),
    createdByUserId: invitingUser.id,
  });
});

test("when an invite is used, a record is created", async ({ createAuth }) => {
  const getDate = vi
    .fn()
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00Z"))
    .mockReturnValueOnce(new Date("2025-01-01T10:01:00Z"));

  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
      generateCode: () => "invite-123",
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
    },
  });

  // biome-ignore lint/suspicious/noExplicitAny:
  const invitingUser = await db.findOne<any>({
    model: "user",
    where: [{ field: "email", value: testUser.email }],
  });

  await db.create({
    model: "invite",
    data: {
      code: "invite-123",
      createdByUserId: invitingUser.id,
      maxUses: 1,
      createdAt: new Date("2025-01-01T10:00:00.000Z"),
      updatedAt: new Date("2025-01-01T10:00:00.000Z"),
      expiresAt: new Date("2025-01-01T23:59:00.000Z"),
    },
  });

  const { data } = await client.signUp.email({
    email: "newuser@example.com",
    password: "password123",
    name: "New User",
    fetchOptions: {
      headers: new Headers({ cookie: "better-auth.invite-code=invite-123" }),
    },
  });

  assert(data);
  const { user: invitedUser } = data;

  // biome-ignore lint/suspicious/noExplicitAny:
  const invite = await db.findOne<any>({
    model: "invite",
    where: [{ field: "code", value: "invite-123" }],
  });

  expect(invite).toMatchObject({
    code: "invite-123",
    createdAt: new Date("2025-01-01T10:00:00.000Z"),
    expiresAt: new Date("2025-01-01T23:59:00.000Z"),
    createdByUserId: invitingUser.id,
  });

  // biome-ignore lint/suspicious/noExplicitAny:
  const inviteUse = await db.findOne<any>({
    model: "invite_use",
    where: [{ field: "inviteId", value: invite.id }],
  });

  expect(inviteUse).toMatchObject({
    inviteId: invite.id,
    usedAt: new Date("2025-01-01T10:01:00.000Z"),
    usedByUserId: invitedUser.id,
  });
});

test("signed-in user with full access can create an invite", async ({
  createAuth,
}) => {
  const getDate = vi
    .fn()
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00.000Z"));
  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
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
  // biome-ignore lint/suspicious/noExplicitAny:
  const invite = await db.findOne<any>({
    model: "invite",
    where: [{ field: "code", value: code }],
  });

  expect(invite).toMatchObject({
    code: "invite-123",
    createdByUserId: user.id,
    createdAt: new Date("2025-01-01T10:00:00Z"),
    expiresAt: new Date("2025-01-01T11:00:00Z"),
  });
});

test("when user accepts invite, invite code gets stored in a cryptographically signed http-only cookie", async ({
  createAuth,
}) => {
  const getDate = vi
    .fn()
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00.000Z"));
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
      createdByUserId: user.id,
      maxUses: 1,
      createdAt: new Date("2025-01-01T10:00:00.000Z"),
      updatedAt: new Date("2025-01-01T10:00:00.000Z"),
      expiresAt: new Date("2025-01-01T23:59:00.000Z"),
    },
  });

  let inviteCode: string | null = null;
  await client.invite.activate(
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
  const getDate = vi
    .fn()
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00.000Z"));
  const { client, testUser } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
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

test("attempting to activate invite already used maxUses times causes error", async ({
  createAuth,
}) => {
  const getDate = vi
    .fn()
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00.000Z"))
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00.000Z"))
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00.000Z"));
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
      createdByUserId: user.id,
      maxUses: 1,
      createdAt: new Date("2025-01-01T10:00:00.000Z"),
      updatedAt: new Date("2025-01-01T10:00:00.000Z"),
      expiresAt: new Date("2025-01-01T23:59:00.000Z"),
    },
  });

  const firstInviteUseResponse = await client.invite.activate({
    code: "invite-123",
  });

  expect(firstInviteUseResponse.error).toBe(null);

  await client.signUp.email({
    email: "newuser@example.com",
    password: "password123",
    name: "New User",
    fetchOptions: {
      headers: new Headers({ cookie: "better-auth.invite-code=invite-123" }),
    },
  });

  const secondInviteUseResponse = await client.invite.activate({
    code: "invite-123",
  });

  expect(secondInviteUseResponse.error).toMatchInlineSnapshot(`
    {
      "code": "NO_USES_LEFT_FOR_INVITE_CODE",
      "message": "No uses left for invite code",
      "status": 400,
      "statusText": "BAD_REQUEST",
    }
  `);
});

test("invite cannot be used more than maxUses times, even if it's already active", async ({
  createAuth,
}) => {
  const getDate = vi
    .fn()
    .mockReturnValueOnce(new Date("2025-01-01T10:00:00Z"))
    .mockReturnValueOnce(new Date("2025-01-01T10:01:00Z"))
    .mockReturnValueOnce(new Date("2025-01-01T10:02:00Z"))
    .mockReturnValueOnce(new Date("2025-01-01T10:03:00Z"));

  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
      generateCode: () => "invite-123",
      roleForSignupWithoutInvite: "guest",
      roleForSignupWithInvite: "user",
    },
  });

  // biome-ignore lint/suspicious/noExplicitAny:
  const invitingUser = await db.findOne<any>({
    model: "user",
    where: [{ field: "email", value: testUser.email }],
  });

  await db.create({
    model: "invite",
    data: {
      code: "invite-123",
      createdByUserId: invitingUser.id,
      maxUses: 1,
      createdAt: new Date("2025-01-01T10:00:00.000Z"),
      updatedAt: new Date("2025-01-01T10:00:00.000Z"),
      expiresAt: new Date("2025-01-01T23:59:00.000Z"),
    },
  });

  const firstSignupResponse = await client.signUp.email({
    email: "newuser1@example.com",
    password: "password123",
    name: "New User 1",
    fetchOptions: {
      headers: new Headers({ cookie: "better-auth.invite-code=invite-123" }),
    },
  });

  expect(firstSignupResponse.error).toBe(null);

  const secondSignupResponse = await client.signUp.email({
    email: "newuser2@example.com",
    password: "password123",
    name: "New User 2",
    fetchOptions: {
      headers: new Headers({ cookie: "better-auth.invite-code=invite-123" }),
    },
  });

  expect(secondSignupResponse.error).toMatchInlineSnapshot(`
    {
      "code": "NO_USES_LEFT_FOR_INVITE_CODE",
      "message": "No uses left for invite code",
      "status": 400,
      "statusText": "BAD_REQUEST",
    }
  `);
});

test.todo("attempting to activate non-existing invite causes error");

test.todo("attempting to activate expired invite causes error");

test.todo("after successful sign-in, invite cookie is cleared");

test.todo(
  "custom runtime criteria for invite creation override default role check",
);

test.todo("works with email signin");

test.todo("works with email signup");

test.todo("works with email-top signin");

test.todo("works with oauth signin");
