# Prompt 00 — Project Scaffold

**Phase:** 0 (run first, before all others)
**Depends on:** nothing
**Blocks:** all other prompts

## Task

Create the project scaffold for a TypeScript Node.js project called "handshake" in the current directory. Do NOT initialize git — that will be done separately.

## Instructions

### 1. package.json

Create `package.json`:

```json
{
  "name": "handshake",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start:web": "tsx src/web.ts",
    "dev": "tsx watch src/web.ts",
    "start:cli": "tsx src/index.ts start",
    "demo:device1": "MY_USER_ID=alice MY_USER_NAME=Alice tsx src/index.ts start",
    "demo:device2": "MY_USER_ID=bob MY_USER_NAME=Bob tsx src/index.ts start"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@metaplex-foundation/js": "^0.20.1",
    "@solana/spl-token": "^0.4.9",
    "@solana/web3.js": "^1.98.0",
    "bonjour-service": "^1.3.0",
    "dotenv": "^16.4.7",
    "eventemitter3": "^5.0.1",
    "stripe": "^17.5.0",
    "ws": "^8.18.0",
    "tsx": "^4.19.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.7.0"
  }
}
```

### 2. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

### 3. .env.example

Create `.env.example` with all variables (copy exactly):

```env
# ── ElevenLabs (STT + TTS) ──────────────────
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_VOICE_NAME=Rachel
ELEVENLABS_MODEL=eleven_monolingual_v1
ELEVENLABS_REGION=us
ELEVENLABS_LANGUAGE=en

# ── Stripe ───────────────────────────────────
STRIPE_SECRET_KEY=sk_test_...
STRIPE_ACCOUNT_ID=acct_...
STRIPE_PAYMENT_METHOD=

# ── LLM ──────────────────────────────────────
LLM_PROVIDER=anthropic
LLM_API_KEY=
LLM_MODEL=claude-sonnet-4-20250514

# ── User Identity ────────────────────────────
MY_USER_ID=
MY_USER_NAME=

# ── Monzo (optional) ────────────────────────
MONZO_ACCESS_TOKEN=

# ── Miro (optional) ─────────────────────────
MIRO_ACCESS_TOKEN=
MIRO_BOARD_ID=

# ── Solana (optional) ───────────────────────
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_KEYPAIR_SECRET=
SOLANA_NETWORK=devnet
SOLANA_USDC_MINT=
SOLANA_MY_PUBKEY=

# ── Feature Flags ───────────────────────────
ENABLE_SOLANA=false
ENABLE_EMOTION_DETECTION=true
ENABLE_NFT_MINTING=false

# ── Server ──────────────────────────────────
PORT=3000
```

### 4. railway.toml

```toml
[build]
buildCommand = "npm ci"

[deploy]
startCommand = "npx tsx src/web.ts"
healthcheckPath = "/health"
```

### 5. .gitignore

```
node_modules/
dist/
.env
*.log
/tmp/
```

### 6. Directory structure

Create empty directories:
- `src/`
- `src/providers/`
- `src/services/`
- `public/`

### 7. Install dependencies

Run `npm install` to generate the lock file.

## Verification

- `ls src/ src/providers/ src/services/ public/` — all directories exist
- `cat package.json` — valid JSON with correct deps
- `node_modules/` exists after npm install
- `npx tsc --noEmit` will fail (no source files yet) — that's expected
