**UNDER DEVELOPMENT — ALPHA**

# Invite System for better-auth

## Features

- Invites don't depend on the inviter knowing the invitee's email — invite links can be shared over 3rd-party platforms (instant messaging, SMS) or live (with a QR code).
  - Choice of email to sign up with is up to the invitee.
- Users without invite can sign up with reduced access (useful for waitlist functionality).
- Meant to work with all authentication methods. Currently tested: email and password; email OTP; social.
- Customizable code duration, code generation, and invite creation and acceptance criteria (e.g. to limit upgrade to users from a given domain).
- Keeps track of who created and who accepted the invite.

## Mode of Operation

`better-auth-invite` works in concert with the `admin` plugin and its access control capabilities.

When a user redeems a valid invite, the invite code gets stored into a signed, http-only cookie in the user's browser.

If a user without an active invite signs up, he or she receives the default role, as defined by the `admin` plugin. That is `"user"` by default, but you might want to reserve that for invited users, and set the default role to `"guest"` for clarity.

If a user with an active invite signs up or signs in, his or her role gets upgraded.

## Alternatives

- [@better-auth-kit/app-invite](https://www.better-auth-kit.com/docs/plugins/app-invite)

## Setup

### Server-Side Setup

Import the `invite` plugin and add it to your `betterAuth` configuration.

**Important**: make sure `defaultRole` in the `admin` plugin options and `roleForSignupWithoutInvite` in the `invite` plugin options match.

```typescript
import { betterAuth } from "better-auth";
import { admin as adminPlugin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { invite } from "better-auth-invite";

// Define your access control statements and roles
const statement = { ...defaultStatements } as const;
const ac = createAccessControl(statement);
const guest = ac.newRole({ ...userAc.statements });
const user = ac.newRole({ ...userAc.statements });
const admin = ac.newRole({ ...adminAc.statements });

const auth = betterAuth({
  database, // Your database adapter
  plugins: [
    adminPlugin({
      ac,
      roles: { guest, user, admin },
      defaultRole: "guest",
    }),
    invite({
      inviteDurationSeconds: 3600, // Invites valid for 1 hour
      roleForSignupWithoutInvite: "guest", // Role for users signing up without an invite
      roleForSignupWithInvite: "user", // Role for users signing up with a valid invite
      // Optional:
      // generateCode: () => generateRandomString(8),
      // canCreateInvite: (user) => user.role === 'manager',
      // canAcceptInvite: (user) => user.email.endsWith('@acme.com'),
    }),
  ],
  emailAndPassword: { enabled: true }, // Or other auth strategies
  // ... other betterAuth options
});
```

**`InviteOptions`:**

- `inviteDurationSeconds` (number, required): The duration in seconds for which an invite code is valid after its creation.
- `roleForSignupWithoutInvite` (string, required): The role assigned by the `admin` plugin to users who sign up without an active invite.
- `roleForSignupWithInvite` (string, required): The role assigned to users who sign up with a valid, active invite.
- `canCreateInvite` (function, optional): A function `(user: UserWithRole) => boolean` that determines if a given user can create invites. If not provided, any authenticated user who is not in the `roleForSignupWithoutInvite` can create invites.
- [TODO] `canAcceptInvite` (function, optional): A function `(user: UserWithRole) => boolean` that determines if a given user can accept/redeem an invite. If not provided, any user can accept an invite.
- `generateCode` (function, optional): A function `() => string` that returns a string to be used as the invite code. Defaults to a cryptographically strong random string generator (6 characters, 0-9, A-Z).
- `getDate` (function, optional): A function `() => Date` that returns the current `Date`. Defaults to `() => new Date()`. Useful for testing time-sensitive features.

### Client-Side Setup

Import the `inviteClient` plugin and add it to your `betterAuth` client configuration.

```typescript
import { createClient } from "better-auth/client"; // Or your client creation utility
// Adjust the import path based on your project setup
import { inviteClient } from "./client.js";

const client = createClient({
  // ... other client options
  plugins: [inviteClient()],
});
```

## Usage

### 1. Creating Invites

Authenticated users can create invite codes. The client plugin (`client.invite.create`) provides a method for this:

```typescript
import { client } from "@/lib/auth-client";

const { data, error } = await client.invite.create({
  _: true, // better-call seems to require a body to be always defined for POST
});

if (error) {
  console.error("Failed to create invite:", error);
  return;
}

if (data) {
  console.log("Invite code created:", data.code);
  // Example response: { data: { code: "invite-123" }, error: null }
  return data.code;
}
```

The server will handle storing this invite code, associating it with the creating user, and setting its expiry based on `inviteDurationSeconds`.

### 2. Redeeming Invites

When a user receives an invite code, he or she needs to redeem it. This is typically done by visiting a specific link or entering the code on a page. The client plugin (`client.invite.redeem`) provides a method to handle this.

```typescript
// Assuming 'client' is your configured better-auth client instance

async function redeemInvite(code: string) {
  const { data, error } = await client.invite.redeem({ code });

  if (error) {
    console.error("Failed to redeem invite:", error);
    // Handle error (e.g., code invalid, expired, already used)
    return false;
  }

  // On successful redemption, a cookie named 'better-auth.invite-code'
  // is set in the user's browser. This cookie will be used during sign-up.
  console.log("Invite redeemed successfully. User can now sign up.");
  return true;
}
```

### 3. Signing Up

The invite system integrates with the standard sign-up process. The behavior depends on whether a user has an active, redeemed invite.

**Scenario 1: Signing Up or Signing In with an Active Invite**

1.  **Redeem Invite**: The user first redeems an invite code (see "Redeeming Invites"). This sets a `better-auth.invite-code` cookie.
2.  **Sign Up**: The user proceeds to sign up (e.g., using email and password).
3.  **Role Upgrade**: If a valid `better-auth.invite-code` cookie is present, the invite is validated. Additionally, if a `canAcceptInvite` function is configured, it is evaluated for the user. If all conditions are met and the user's initial role (as defined by `roleForSignupWithoutInvite`) is appropriate for an upgrade:
    - The user's role is upgraded to `roleForSignupWithInvite`.
    - The invite code is marked as used in the database.
    - The `better-auth.invite-code` cookie is cleared.

```typescript
// Assuming 'client' is your configured better-auth client instance
// and the user has already redeemed an invite code (the 'better-auth.invite-code' cookie is set).

async function signUpNewUserWithInvite(email, password, name) {
  const { data, error } = await client.signUp.email({
    email,
    password,
    name,
  });

  if (error) {
    console.error("Sign-up failed:", error);
    return;
  }

  if (data) {
    console.log(
      "Sign-up successful, user should have roleForSignupWithInvite:",
      data.user,
    );
    // data.user contains the new user object, whose role should now be roleForSignupWithInvite.
    // data.token contains the session token.
  }
}
```

**Scenario 2: Signing Up Or Signing In Without an Invite (or with an Invalid/Expired Invite)**

Users can also sign up without an invite code. This is useful to implement waiting lists.

1.  **Sign Up**: The user signs up directly without redeeming an invite, or if their redeemed invite is invalid, expired, or already used.
2.  **Default Role**:
    - The user is created with the default role as defined in the `admin` plugin.
    - The `invite` plugin does not run.

This allows the system to capture user interest even if invites are limited. Their role can be upgraded later, potentially by issuing them an invite or through other administrative actions.

```typescript
// Assuming 'client' is your configured better-auth client instance

async function signUpNewUserWithoutInvite(email, password, name) {
  const { data, error } = await client.signUp.email({
    email,
    password,
    name,
  });

  if (error) {
    console.error("Sign-up failed:", error);
    // Standard sign-up errors.
    return;
  }

  if (data) {
    console.log(
      "Sign-up successful, user should have roleForSignupWithoutInvite:",
      data.user,
    );
    // data.user contains the new user object with the roleForSignupWithoutInvite.
    // data.token contains the session token.
  }
}
```

## Database Schema

The invite plugin adds an `invite` table to your database. Key fields include:

- `code` (string, unique): The invite code.
- `invitedByUserId` (string, references `user.id`): The ID of the user who created the invite.
- `usedByUserId` (string, optional, references `user.id`): The ID of the user who used the invite.
- `used` (boolean): Whether the invite has been used.
- `createdAt` (date): Timestamp of creation.
- `expiresAt` (date): Timestamp when the invite expires.
- `usedAt` (date, optional): Timestamp when the invite was used.

This schema is managed by `better-auth` migrations when the plugin is active and `shouldRunMigrations: true` is set during initialization.
