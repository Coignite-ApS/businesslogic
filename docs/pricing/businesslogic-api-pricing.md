# Businesslogic API Pricing Calculator — Documentation

## Overview

This Google Sheets calculator computes the monthly and annual cost of using the Businesslogic API. Pricing has two independent components:

1. **Microservices** — a flat monthly subscription per microservice, with volume-based tiered pricing.
2. **API Calls** — a pay-per-call charge with progressive (bracket) tiered pricing.

All internal prices are denominated in **DKK**. Outputs are converted to the user's chosen currency (DKK, EUR, or USD) using hardcoded exchange rates stored in the Valuta sheet.

---

## Sheet Structure

The workbook contains four sheets:

| Sheet | Purpose |
|---|---|
| `Pricing` | User inputs and final output prices |
| `Webservices` | Tiered microservice price table and per-tier cost calculation |
| `Webservice calls` | Tiered API call price table and per-tier cost calculation |
| `Valuta` | Currency exchange rates (DKK as base) |

---

## Inputs (Pricing Sheet)

| Cell | Label | Description |
|---|---|---|
| B3 | Microservice | Number of microservices to subscribe to |
| B4 | Calls | Estimated total monthly API calls |
| D3 | Yearly saving | Discount applied when paying annually (default: 15%) |
| E3 | Server price | Multiplier for on-premise deployment vs. cloud (default: 1000% = 10×) |
| F3 | Valuta | Output currency: `DKK`, `Euro`, or `USD` |

---

## Outputs (Pricing Sheet)

| Cell | Label | Description |
|---|---|---|
| B8 | Microservice price | Monthly microservice cost in selected currency |
| B9 | Calls price | Monthly API call cost in selected currency |
| B13 | Cloud price (Monthly) | Total monthly cloud-hosted cost |
| C13 | Cloud price (Yearly) | Annual cloud cost with yearly discount applied |
| B14 | Server price (Monthly) | Monthly on-premise deployment cost |
| C14 | Server price (Yearly) | Annual on-premise cost with yearly discount applied |

---

## Pricing Logic

### Step 1 — Microservice Cost

Microservice pricing uses **volume-based tiered pricing**: the price per unit depends entirely on which tier the *total* subscription quantity falls into. Unlike progressive bracket pricing, the entire quantity is charged at the single rate of the qualifying tier.

**Microservice price tiers (DKK/unit/month):**

| Tier | Max units | Price per unit (DKK) | Step discount | Cumulative discount |
|---|---|---|---|---|
| 1 | 1 | 20.00 | 0% | 0% |
| 2 | 5 | 19.00 | 5% | 5% |
| 3 | 25 | 18.00 | ~5% | 10% |
| 4 | 50 | 17.00 | 6% | 15% |
| 5 | 100 | 16.00 | 6% | 20% |
| 6 | 500 | 15.00 | 6% | 25% |
| 7 | 1,000,000,000 | 14.00 | ~7% | 30% |

The "step discount" and "cumulative discount" columns are informational only — they are not used in any formula. They show how much cheaper each tier is relative to the previous one and to tier 1 respectively.

**Formula (Webservices sheet, column I):**

```
Cost per tier = Price/unit (DKK) × Units falling in that tier × Exchange rate
```

The bracket logic (column H) determines how many of the subscribed microservices fall into each tier. With the current 7 tiers and their upper bounds, the formula correctly handles any quantity up to 1 billion units.

**Total monthly microservice cost** = `SUM(I2:I9)` → referenced in Pricing as `Webservices!I9`.

---

### Step 2 — API Call Cost

API call pricing uses **progressive (bracket) tiered pricing** — the same model as income tax brackets. The total call volume is split across tiers, and each portion is charged at that tier's rate. Only the calls that fall within a tier are charged at that tier's price.

**API call price tiers (DKK/call):**

| Tier | Calls in tier | Price per call (DKK) | Step discount | Cumulative discount |
|---|---|---|---|---|
| 1 | Up to 10,000 | 0.00200 | 0% | 0% |
| 2 | Next 50,000 | 0.00150 | 25% | 25% |
| 3 | Next 100,000 | 0.00100 | 33% | 50% |
| 4 | Next 1,000,000 | 0.00060 | 40% | 70% |
| 5 | Next 5,000,000 | 0.00040 | 33% | 80% |
| 6 | Next 1,000,000,000 | 0.00030 | 25% | 85% |

The step/cumulative discount columns are for reference only.

**Formula (Webservice calls sheet, column H):**

```
Cost per tier = Price/call (DKK) × Calls in that tier × Exchange rate
```

Column I is an intermediate calculation (`Calls in tier × Exchange rate`) used internally to compute column H. The row 10 sum of column I is a numerical artefact and does not represent total call count.

**Total monthly call cost** = `SUM(H2:H8)` → referenced in Pricing as `'Webservice calls'!H9`.

**Example — 1,000,000 calls:**

| Tier | Calls charged | Rate (DKK) | Cost (DKK) |
|---|---|---|---|
| Tier 1 | 10,000 | 0.002 | 20.00 |
| Tier 2 | 50,000 | 0.0015 | 75.00 |
| Tier 3 | 100,000 | 0.001 | 100.00 |
| Tier 4 | 840,000 | 0.0006 | 504.00 |
| **Total** | **1,000,000** | | **699.00 DKK** |

---

### Step 3 — Monthly Cloud Price

```
Cloud monthly = ROUND(Microservice cost + Call cost)
             = ROUND(B8 + B9)
```

Both B8 and B9 are already in the selected output currency at this point.

---

### Step 4 — Yearly Cloud Price

```
Cloud yearly = ROUND(Cloud monthly × (1 − Yearly saving%) × 12)
```

With the default 15% yearly saving:

```
Cloud yearly = ROUND(Cloud monthly × 0.85 × 12)
```

The yearly saving represents the discount a customer receives for committing to annual billing instead of month-by-month.

---

### Step 5 — Server (On-Premise) Price

```
Server monthly = ROUND(Cloud monthly × Server price%)
Server yearly  = ROUND(Server monthly × (1 − Yearly saving%) × 12)
```

The **Server price** multiplier (default: 1000% = 10×) accounts for the additional cost of dedicated on-premise infrastructure, setup, and support. This multiplier should be reviewed carefully before presenting to customers, as it significantly increases the quoted price.

---

## Currency Conversion (Valuta Sheet)

All base prices in the calculator are in **DKK**. Conversion to the selected output currency happens inline within the Webservices and Webservice calls sheets using an `HLOOKUP` against the Valuta table.

**Exchange rates (as of Apr 2026):**

| Currency | Rate (1 DKK = ?) |
|---|---|
| DKK | 1.00 |
| Euro | 0.13 |
| USD | 0.14 |

The rates are **hardcoded** and must be updated manually. The `Last updated` row (row 3) records when rates were last checked. To make rates live, the hardcoded values can be replaced with:

- `=GOOGLEFINANCE("CURRENCY:DKKEUR")`
- `=GOOGLEFINANCE("CURRENCY:DKKUSD")`

The currency selection in `Pricing!F3` is used as the lookup key:

```
HLOOKUP(Pricing!$F$3, Valuta!$1:$2, 2, FALSE)
```

It must exactly match one of the column headers in row 1 of the Valuta sheet (`DKK`, `Euro`, `USD`).

---

## Full Worked Example

**Inputs:**
- Microservices: 1
- Monthly calls: 1,000,000
- Yearly saving: 15%
- Server price: 1000% (10×)
- Currency: USD

**Step 1 — Microservice cost:**
- 1 unit → Tier 1 → 20.00 DKK × 0.14 (USD rate) = **2.80 USD**

**Step 2 — Call cost (USD):**

| Tier | Calls | DKK rate | USD rate | Cost (USD) |
|---|---|---|---|---|
| 1 | 10,000 | 0.002 | 0.14 | 2.80 |
| 2 | 50,000 | 0.0015 | 0.14 | 10.50 |
| 3 | 100,000 | 0.001 | 0.14 | 14.00 |
| 4 | 840,000 | 0.0006 | 0.14 | 70.56 |
| **Total** | **1,000,000** | | | **97.86 USD** |

**Step 3 — Cloud monthly:**

```
ROUND(2.80 + 97.86) = 101 USD/month
```

**Step 4 — Cloud yearly (15% discount):**

```
ROUND(101 × 0.85 × 12) = 1,030 USD/year
```

**Step 5 — Server monthly / yearly:**

```
Server monthly = ROUND(101 × 10)          = 1,010 USD/month
Server yearly  = ROUND(1,010 × 0.85 × 12) = 10,302 USD/year
```

---

## Maintenance Notes

- **Exchange rates** must be updated manually in the Valuta sheet. Update the `Last updated` field (A3) whenever rates are refreshed.
- **Pricing tiers** can be edited directly in the Webservices and Webservice calls sheets (columns A and B). All downstream formulas update automatically.
- **Adding a new tier** requires inserting a new row in the relevant sheet and ensuring the SUM ranges in the totals row cover the new row.
- **Adding a new currency** requires adding a new column to the Valuta sheet (row 1 = currency code, row 2 = rate) and adding that code to the dropdown validation on `Pricing!F3`.
