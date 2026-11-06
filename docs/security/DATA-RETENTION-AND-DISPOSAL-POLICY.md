# Data Retention and Disposal Policy

**Company:** RS Solutions Inc. (operating Bargain Bay and RS Solutions)
**Address:** 1135 Squires Beach Rd, Pickering, ON L1W 3T9, Canada
**Policy owner:** Owner / Director (Service@rssolutions.ca)
**Version:** 1.0
**Effective date:** November 2, 2026
**Review cycle:** at least once every 12 months, and when the law, our systems or the data we collect change
**Related policies:** Information Security Policy; Access Controls Policy; Privacy Policy (https://bargainbay.ca/policies/privacy)

## 1. Purpose and scope

This policy sets how long RS Solutions keeps each kind of information, why, and how it is securely deleted or destroyed when that period ends. It applies to all personal and financial information we hold in any form: the Bargain Bay and RS Solutions web applications and database, the master inventory tracker (Google Sheets), files stored with our hosting provider, email, backups and exports, paper records, and data received from service providers including bank transaction data received through Plaid.

It follows Canada's Personal Information Protection and Electronic Documents Act (PIPEDA), Canada's Anti-Spam Legislation (CASL), and the record-keeping requirements of the Canada Revenue Agency (CRA) and Ontario law.

## 2. Principles

- **Collect and keep only what we need.** Information is kept for the purpose it was collected for and for any period the law requires, and no longer.
- **Law first.** Where a legal record-keeping period applies, it overrides a request to delete earlier. Where none applies, we delete when the purpose has ended.
- **No bank credentials.** We never receive or store anyone's online banking username or password. Bank connections are made inside Plaid Link; we hold only an access token and the transaction data it returns.
- **Dispose securely.** Deletion must make the information unrecoverable in ordinary use, and extends to copies we control.

## 3. Retention schedule

| Information | Kept for | Why | How it ends |
|---|---|---|---|
| **Orders, invoices, payments, refunds, tax (HST) records** | 6 years from the end of the tax year to which they relate | CRA and Excise Tax Act record-keeping | Deleted, or customer details removed and figures kept in anonymised form |
| **Business bank transaction data received through Plaid** (the company's own accounts) | 6 years from the end of the tax year, as an accounting record | CRA record-keeping; bookkeeping and HST review | Deleted with the expense records at the end of the period |
| **Plaid access token** (bank connection) | Only while the connection is active | Needed to receive transactions | Connection removed by an administrator, which revokes the token at Plaid and deletes our stored copy. Done immediately when the connection is no longer needed or an account is closed |
| **Customer account and contact details** | While the account is active, then until the end of the legal period for any orders on it | Providing the service; warranty and returns | Deleted or anonymised on request or after inactivity, subject to the order and tax records above |
| **Marketing consent and opt-out records** | At least 3 years after the last message or after consent is withdrawn | CASL requires us to prove consent | Deleted after that period. Opt-outs are kept so a person is never re-contacted |
| **Abandoned-cart details** (name, email, phone captured at checkout) | Until the person buys, or at most 12 months | Staff follow-up of unfinished checkouts | Deleted at the 12-month review |
| **Quotes and leads that did not become a sale** | 24 months | Following up; showing why we contacted someone | Deleted at the annual review |
| **Delivery records** (signatures, delivery photos, proof of delivery) | 2 years after delivery, or until any open claim or dispute is closed | Damage and warranty claims | Files deleted from storage; database entries removed |
| **Driver location data** | 30 days | Day-to-day dispatch only | **Automatic:** older records are deleted by the application |
| **Sign-in attempt and two-factor attempt records** | 30 days | Lock-out and abuse prevention | **Automatic:** older records are deleted by the application |
| **Audit log** (who changed what, and when) | 6 years | Accountability for financial changes | Deleted at the end of the period |
| **Employee and contractor records, payroll and clock data** | 6 years after employment ends | CRA and employment-standards requirements | Deleted or shredded at the end of the period |
| **Marketplace vendor records** (applications, agreements, statements) | 6 years after the relationship ends | Tax and contract records | Deleted at the end of the period. Vendor bank account numbers are deleted when the account is replaced or the vendor leaves, once any final payout has settled |
| **Security and system logs** | 12 months | Investigating incidents | Deleted when the provider's log window ends or at review |
| **Database backups and exports** | Provider recovery window for backups; exports kept no more than 12 months | Disaster recovery | Backups roll off automatically; exports deleted by the owner at the annual review. Exports are held only in access-controlled storage |
| **Paper records containing personal information** | Same as the electronic record they copy | — | Cross-cut shredding |

A shorter period applies automatically where the table says so. Every other deletion is carried out in the annual review described in section 5.

## 4. Disposal methods

- **Database records:** deleted with the application's own functions or SQL, or anonymised by removing names, contact details and addresses while keeping the figures the law requires us to keep.
- **Files and photos in cloud storage:** deleted from the hosting provider's storage; copies in backup and export folders are deleted at the same review.
- **Spreadsheets and exports:** deleted, and removed from trash and version history where that is possible.
- **Bank connections:** removed in the application, which also revokes access at Plaid.
- **Devices:** a company device that stored personal information is wiped (factory reset, with disk encryption) before reuse, sale or disposal.
- **Paper:** cross-cut shredded.
- **Service providers:** when we end a relationship with a provider that holds our data, we delete our data from their service or ask them to, and keep the confirmation.

## 5. Review and enforcement

- **Annual retention review.** At least once every 12 months the owner reviews each category in section 3, deletes everything past its period, deletes expired exports and old files, confirms the automatic deletions are still running, and records the date and what was removed. The review is also run when a service provider or a data category changes.
- **Legal hold.** If there is a dispute, claim, audit or investigation, the relevant records are kept, and not deleted under this policy, until it is finished.
- **Roles.** The owner is accountable for this policy. Staff must not keep personal information outside company systems, and must not delete records except as this policy or the owner directs.
- **Exceptions** need the owner's written approval with a reason and an end date.

## 6. Requests from individuals

Anyone can ask to see, correct or delete the personal information we hold about them, and can withdraw consent, by writing to Service@rssolutions.ca. We verify who is asking, respond within 30 days, and delete or anonymise what the law allows. If a legal retention period applies, we tell the person which information must be kept and until when, restrict its use to that purpose, and delete it when the period ends. Opt-outs from marketing are recorded and kept so that they are honoured.

## 7. Incidents and loss

A suspected loss or exposure of personal information is handled under the incident response process in the Information Security Policy. Where retention or disposal fails (for example data kept past its period and then exposed), it is treated as an incident, corrected, and this policy is updated if needed.
