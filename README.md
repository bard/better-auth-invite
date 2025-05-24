**UNDER DEVELOPMENT — NOT READY FOR PRODUCTION**

# Invite System Module for better-auth

This document describes how to use the invite system module with `better-auth`. The invite system allows you to restrict user sign-ups to only those who possess a valid invite code.

## Features

- Restrict sign-ups to invited users.
- Allow authenticated users to generate invite codes.
- Customizable invite code duration, ID generation, and date handling (primarily for testing).

## Setup

To use the invite system, you need to configure it on both the server-side (within `betterAuth`) and provide the client-side plugin.

### Server-Side Setup

Import the `invite` plugin and add it to your `betterAuth` configuration.

```typescript
import { betterAuth } from "better-auth";
import { invite } from "better-auth-invite";

const auth = betterAuth({
  database, // Your database adapter
  plugins: [
    invite({
      inviteDurationSeconds: 3600, // Invites valid for 1 hour
      // Optional:
      // generateId: () => generateRandomString(),
    }),
  ],
  emailAndPassword: { enabled: true }, // Or other auth strategies
  // ... other betterAuth options
});
```

**`InviteOptions`:**

- `inviteDurationSeconds` (number, required): The duration in seconds for which an invite code is valid after its creation.
- `generateId` (function, optional): A function that returns a string to be used as the invite code. Defaults to a random string generator.
- `getDate` (function, optional): A function that returns the current `Date`. Defaults to `() => new Date()`. Useful for testing time-sensitive features.

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
// Assuming 'client' is your configured better-auth client instance
// and the user is already signed in.

async function createInviteCodeExample() {
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
}
```

The server will handle storing this invite code, associating it with the creating user, and setting its expiry based on `inviteDurationSeconds`.

### 2. Redeeming Invites

When a user receives an invite code, they need to redeem it. This is typically done by visiting a specific link or entering the code on a page. The client plugin (`client.invite.redeem`) provides a method to handle this.

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

### 3. Signing Up with an Invite

If the invite system is active, new users attempting to sign up must have a redeemed invite code. The `better-auth` system automatically checks for the `better-auth.invite-code` cookie during the sign-up process.

- If a valid invite code (from the cookie) is present, the sign-up process will proceed.

```typescript
// Assuming 'client' is your configured better-auth client instance
// and the user has already redeemed an invite code (the 'better-auth.invite-code' cookie is set).

async function signUpNewUser(email, password, name) {
  const { data, error } = await client.signUp.email({
    email,
    password,
    name,
  });

  if (error) {
    console.error("Sign-up failed:", error);
    // This could be the invite-related error if the cookie was missing/invalid,
    // or other standard sign-up errors.
    return;
  }

  if (data) {
    console.log("Sign-up successful:", data.user);
    // data.user contains the new user object
    // data.token contains the session token
  }
}
```

- If the cookie is missing or the code is invalid/expired/used, the sign-up call will return an error:

```json
{
  "code": "AN_INVITE_CODE_IS_REQUIRED_TO_SIGN_UP",
  "message": "An invite code is required to sign up.",
  "status": 403,
  "statusText": "FORBIDDEN"
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
