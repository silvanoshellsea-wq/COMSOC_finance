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

This repository is configured for local development. Hosting, hosted backups, and Cloudflare billing are outside the current setup.
