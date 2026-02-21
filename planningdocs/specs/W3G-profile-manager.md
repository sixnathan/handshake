# W3G — ProfileManager

**File to create:** `src/services/profile-manager.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** RoomManager (stores profiles on join), AgentService (reads profile for system prompt)

---

## Purpose

Server-side storage of agent profiles for the duration of a session. Profiles are sent from the browser (localStorage) when a user joins a room. The ProfileManager validates and stores them in memory.

---

## Imports

```ts
import type { UserId, AgentProfile, AgentPreferences } from "../types.js";
import type { IProfileManager } from "../interfaces.js";
```

---

## Class: ProfileManager

```ts
export class ProfileManager implements IProfileManager
```

### Private State

```ts
private profiles = new Map<UserId, AgentProfile>();
```

### Methods

**`setProfile(userId: UserId, profile: AgentProfile): void`**
1. Validate the profile (see validation below)
2. Store: `this.profiles.set(userId, { ...profile })` — shallow copy to prevent external mutation

**`getProfile(userId: UserId): AgentProfile | undefined`**
1. `const profile = this.profiles.get(userId)`
2. If not found, return `undefined`
3. Return `{ ...profile }` — shallow copy

**`getDefaultProfile(userId: UserId): AgentProfile`**
- Return a sensible default profile:
  ```ts
  return {
    displayName: userId,
    role: "participant",
    customInstructions: "",
    preferences: {
      maxAutoApproveAmount: 5000,       // £50 in pence
      preferredCurrency: "gbp",
      escrowPreference: "above_threshold",
      escrowThreshold: 10000,           // £100 in pence
      negotiationStyle: "balanced",
    },
  };
  ```

**`removeProfile(userId: UserId): void`**
- `this.profiles.delete(userId)`

### Private: Validation

**`private validate(profile: AgentProfile): void`**
1. `displayName`: must be non-empty string, max 100 chars. Trim whitespace.
   - If empty after trim: throw `Error("displayName is required")`
   - Truncate to 100 chars
2. `role`: must be non-empty string, max 100 chars
   - If empty: default to `"participant"`
3. `customInstructions`: string, max 2000 chars
   - Truncate to 2000 chars
4. `preferences`:
   - `maxAutoApproveAmount`: must be non-negative number. If negative or NaN: set to 0
   - `preferredCurrency`: must be 3-char string. If invalid: default to `"gbp"`
   - `escrowPreference`: must be one of `"always" | "above_threshold" | "never"`. If invalid: default to `"above_threshold"`
   - `escrowThreshold`: must be non-negative number. If negative or NaN: set to 0
   - `negotiationStyle`: must be one of `"aggressive" | "balanced" | "conservative"`. If invalid: default to `"balanced"`
5. `stripeAccountId`: optional string. If present, must match `/^acct_/`. If invalid: set to `undefined`
6. `monzoAccessToken`: optional string. No format validation (opaque token)

Note: Validation mutates the incoming object before storing. Since `setProfile` makes a copy, this is fine.

Actually — to follow immutability rules, build a new validated object:

```ts
private validate(input: AgentProfile): AgentProfile {
  const displayName = (input.displayName ?? "").trim().slice(0, 100);
  if (!displayName) throw new Error("displayName is required");

  const role = (input.role ?? "participant").trim().slice(0, 100) || "participant";
  const customInstructions = (input.customInstructions ?? "").slice(0, 2000);

  const prefs = input.preferences ?? {};
  const maxAutoApproveAmount = Number(prefs.maxAutoApproveAmount) >= 0 ? Number(prefs.maxAutoApproveAmount) : 0;
  const preferredCurrency = typeof prefs.preferredCurrency === "string" && prefs.preferredCurrency.length === 3
    ? prefs.preferredCurrency.toLowerCase()
    : "gbp";
  const escrowPreference = (["always", "above_threshold", "never"] as const).includes(prefs.escrowPreference as "always")
    ? prefs.escrowPreference
    : "above_threshold";
  const escrowThreshold = Number(prefs.escrowThreshold) >= 0 ? Number(prefs.escrowThreshold) : 0;
  const negotiationStyle = (["aggressive", "balanced", "conservative"] as const).includes(prefs.negotiationStyle as "balanced")
    ? prefs.negotiationStyle
    : "balanced";

  const stripeAccountId = typeof input.stripeAccountId === "string" && input.stripeAccountId.startsWith("acct_")
    ? input.stripeAccountId
    : undefined;

  const monzoAccessToken = typeof input.monzoAccessToken === "string" && input.monzoAccessToken.length > 0
    ? input.monzoAccessToken
    : undefined;

  return {
    displayName,
    role,
    customInstructions,
    preferences: { maxAutoApproveAmount, preferredCurrency, escrowPreference, escrowThreshold, negotiationStyle },
    stripeAccountId,
    monzoAccessToken,
  };
}
```

Then in `setProfile`: `this.profiles.set(userId, this.validate(profile))`

---

## Edge Cases

- Profile with missing `preferences`: defaults applied
- Profile with XSS in `displayName`: not an issue because `displayName` is not rendered as HTML on the server; frontend must escape
- Multiple `setProfile` calls for same user: last one wins (overwrites)

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IProfileManager` interface
- Validates and sanitizes all fields
- Returns copies (not references) from `getProfile`
- Default profile provides sensible values
- Immutable — `setProfile` stores a new validated object
