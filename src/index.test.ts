import { getTestInstance } from "@better-auth-kit/tests";
import { type User, betterAuth } from "better-auth";
import { parseSetCookieHeader } from "better-auth/cookies";
import { hashPassword } from "better-auth/crypto";
import Database from "better-sqlite3";
import { assert, test as baseTest, expect } from "vitest";
import { type InviteClientPlugin, inviteClient } from "./client.js";
import { type InviteOptions, invite } from "./index.js";

const test = baseTest.extend<{
  createAuth: ({
    pluginOptions,
  }: {
    pluginOptions: InviteOptions;
  }) => ReturnType<typeof getTestInstance<{ plugins: [InviteClientPlugin] }>>;
}>({
  createAuth: async ({ task: _task }, use) => {
    const database = new Database(":memory:");

    await use(async ({ pluginOptions }: { pluginOptions: InviteOptions }) => {
      const testInstance = await getTestInstance(
        betterAuth({
          database,
          plugins: [invite(pluginOptions)],
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
        data: testUser,
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

test("user without an invite cannot sign up if signupRequiresInvite is true", async ({
  createAuth,
}) => {
  const { client } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      signupRequiresInvite: true,
    },
  });

  const { data, error } = await client.signUp.email({
    email: "newuser@example.com",
    password: "password123",
    name: "New User",
  });

  expect(data).toBeNull();
  expect(error).toMatchInlineSnapshot(`
      {
        "code": "AN_INVITE_CODE_IS_REQUIRED_TO_SIGN_UP",
        "message": "An invite code is required to sign up.",
        "status": 403,
        "statusText": "FORBIDDEN",
      }
    `);
});

test("user without an invite can sign up if signupRequiresInvite is false", async ({
  createAuth,
}) => {
  const { client } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      signupRequiresInvite: false,
    },
  });

  const { data, error } = await client.signUp.email({
    email: "newuser@example.com",
    password: "password123",
    name: "New User",
  });

  expect(error).toBeNull();
  expect(data).toMatchObject({
    token: expect.any(String),
    user: {
      email: "newuser@example.com",
      name: "New User",
      id: expect.any(String),
    },
  });
});

test("signed-in user can create an invite", async ({ createAuth }) => {
  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate: () => new Date("2025-01-01T10:00:00"),
      generateCode: () => "invite-123",
      signupRequiresInvite: true,
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
      headers: new Headers({
        cookie: authCookie,
      }),
    },
  });

  expect(inviteCreationResponse).toEqual({
    data: { code: "invite-123" },
    error: null,
  });
  assert(inviteCreationResponse.data);

  const { code } = inviteCreationResponse.data;
  const inviteDbRecord = await db.findOne({
    model: "invite",
    where: [{ field: "code", value: code }],
  });

  expect(inviteDbRecord).toMatchObject({
    code: "invite-123",
    invitedByUserId: user.id,
    usedByUserId: "null", // correctly stored as null in the database, but `transformOutput` in create-adapter/index.ts for some reason stringifies it
    createdAt: new Date("2025-01-01T09:00:00Z"),
    expiresAt: new Date("2025-01-01T10:00:00Z"),
    usedAt: null,
  });
});

test("when user redeems invite, invite code gets stored in cookie", async ({
  createAuth,
}) => {
  const getDate = () => new Date("2025-01-01T10:00:00");
  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
      generateCode: () => "invite-123",
      signupRequiresInvite: true,
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
});

test("user with invite can sign up", async ({ createAuth }) => {
  const getDate = () => new Date("2025-01-01T10:00:00");
  const { client, testUser, db } = await createAuth({
    pluginOptions: {
      inviteDurationSeconds: 3600,
      getDate,
      generateCode: () => "invite-123",
      signupRequiresInvite: true,
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

  const signupResponse = await client.signUp.email({
    email: "newuser@example.com",
    password: "password123",
    name: "New User",
    fetchOptions: {
      headers: new Headers({
        cookie: "better-auth.invite-code=invite-123",
      }),
    },
  });

  expect(signupResponse).toMatchObject({
    data: {
      token: expect.any(String),
      user: {
        createdAt: expect.any(Date),
        email: "newuser@example.com",
        emailVerified: false,
        id: expect.any(String),
        image: null,
        name: "New User",
        updatedAt: expect.any(Date),
      },
    },
    error: null,
  });
});
