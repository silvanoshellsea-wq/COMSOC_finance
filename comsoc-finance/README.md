# COMSOC Financial Management

React and Tailwind render the finance workspace. The Cloudflare Worker validates requests and enforces Treasurer and Auditor permissions. Local D1 stores financial records, and local R2 stores receipt files.

## Start locally

Run these commands from the `comsoc-finance` directory:

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run setup:local
npm.cmd run dev
```

1. `ci` installs the versions in the lockfile.
2. `db:migrate` applies the numbered migrations to local D1. Run it again when a migration is added.
3. `setup:local` creates an ignored `.dev.vars` file with a random setup key. It preserves an existing file.
4. `dev` starts Vite and the Worker. Open the address printed in the terminal. On first use, copy the value of `SETUP_KEY` from `.dev.vars` into the setup page and choose separate passwords for Treasurer and Auditor. Each password must have at least 12 characters. Then sign in.

The dev server uses local storage. When working with actual records, keep the server on loopback. To back up the local database and receipts together, stop the server and copy the ignored `.wrangler/state` directory to a private location. Restore that copy only while the server is stopped. Keep backups and `.dev.vars` outside source control.

After signing in, choose a saved workspace or use the plus button to create one. Each workspace saves its own Ledger, allocations, opening balances, and reconciliation data in D1. Receipt files are stored in private local R2. Wait for the saving indicator to clear before closing the app. If another tab changed the same statement, reload the saved version before entering further changes.

**Open practice workspaces** opens the session-only examples. **Existing local records** opens the earlier finance screens and their separate records.

## Workflows

- Use **Ledger** to record income and direct expenses. Use **Cash & GCash** for account transfers and cash envelopes. Internal transfers affect account balances and leave revenue and expenses unchanged.
- Use **Event Budgets** to create events, adjust allocations, and move allocations between events. **Final Allocation** reads the same records. Available budget equals approved allocation less paid expenses and outstanding commitments.
- Use **Purchases** for itemized records. A paid purchase creates an expense. A purchase paid personally creates an outstanding reimbursement. Enter each full or partial settlement under **Reimbursements**. The expense and remaining obligation use that same record.
- Use **Receipts** to attach files to a transaction or outstanding obligation. Receipts are private and go through the authenticated Worker. Images open in a new tab and PDFs download.
- Use **Loans** to record principal and repayments separately from revenue and expenses. Use **Cash Reconciliation** to record a counted balance and its difference without changing the ledger.
- In **Ledger**, the Treasurer can request verification and reverse direct transactions with a reason. The Auditor can verify or flag transactions. Event updates keep the previous values and reason.
- Use **Financial Reports** for filtered tables, CSV exports that open in Excel, and browser print-to-PDF.

## Verify

`npm.cmd test` builds the client and Worker, then runs integration tests against new, isolated D1 and R2 stores. The tests cover roles, transfers, budget allocation, partial reimbursement, overpayment rejection, reversals, loans, reconciliation, and private receipt access. Your local finance data is outside the test stores.

## Host without R2

The production environment uses a separate hosted D1 database and disables receipt uploads. The regular local dev server still uses local D1 and R2.

Sign in with `npx.cmd wrangler login`. Create the `comsoc-finance-hosted` D1 database on the intended account and set its ID in `env.production.d1_databases` in `wrangler.jsonc`. Apply the migrations to that database with `npx.cmd wrangler d1 migrations apply DB --env production --remote`. Use `npm.cmd run build:hosted` to check the production build and `npm.cmd run deploy` to publish it. Set a new `SETUP_KEY` as a Worker secret for the deployed Worker before creating its first Treasurer and Auditor accounts.

The hosted database starts empty apart from migration seed data. Existing local statements, accounts, and receipts stay in local storage until explicitly migrated.
