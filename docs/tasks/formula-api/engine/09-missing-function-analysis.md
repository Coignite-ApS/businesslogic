# 09. Missing Function Analysis

**Status:** completed
**Current:** 355 functions registered (Batch 1 + Quick Wins + Batch 2 complete)
**Target engines:** HyperFormula (HF ~368), IronCalc (IC ~345), Excel (XL ~502)

Legend: HF=HyperFormula, IC=IronCalc, XL=Excel/365, LO=LibreOffice
Complexity: S=simple (1-2hr), M=medium (half day), C=complex (1+ day)

---

## Batch 1 — Common Missing Functions (high-impact, used daily)

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| CONCAT | - | Y | Y | Y | S | Modern CONCATENATE, accepts ranges |
| TEXTJOIN | - | Y | Y | Y | M | Delimiter+ignore_empty+ranges |
| DAYS360 | Y | Y | Y | Y | M | US/EU methods |
| WEEKNUM | Y | Y | Y | Y | S | Week number of year |
| YEARFRAC | Y | Y | Y | Y | M | Day count bases (0-4) |
| NETWORKDAYS | Y | Y | Y | Y | M | Workdays between dates, holiday list |
| WORKDAY | Y | Y | Y | Y | M | Add workdays, holiday list |
| TIMEVALUE | Y | Y | Y | Y | S | Parse time string → serial |
| SUBTOTAL | Y | Y | Y | Y | M | 11 aggregate functions, ignore hidden |
| ROMAN | Y | Y | Y | Y | S | Number → roman numeral |
| ARABIC | Y | - | Y | Y | S | Roman → number |
| INTERCEPT | - | Y | Y | Y | S | Linear regression intercept (have SLOPE) |
| MAXA | Y | Y | Y | Y | S | MAX treating text as 0 |
| MINA | Y | Y | Y | Y | S | MIN treating text as 0 |
| STDEV.S | Y | Y | Y | Y | S | Alias for STDEV |
| VAR.S | Y | Y | Y | Y | S | Alias for VAR |
| BASE | Y | Y | Y | Y | S | Number → base-N string |
| DECIMAL | Y | Y | Y | Y | S | Base-N string → number |
| MULTINOMIAL | Y | Y | Y | Y | S | n!/(n1!*n2!*...) |
| SERIESSUM | Y | Y | Y | Y | S | Power series sum |
| FORMULATEXT | Y | Y | Y | Y | S | Return formula as text |
| TRUE | Y | Y | Y | Y | S | Constant function |
| FALSE | Y | Y | Y | Y | S | Constant function |

**Batch 1 total: 22 functions** — mostly S/M complexity, high usage frequency.
**Status: COMPLETE** — All implemented except FORMULATEXT (needs formula storage per cell, deferred).

---

## Batch 2 — Statistical Distributions (finance/science)

### 2A — Normal, T, Chi-Squared, F distributions

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| NORM.DIST | Y | Y | Y | Y | M | Normal CDF/PDF (have NORM.S.DIST) |
| NORM.INV | Y | Y | Y | Y | M | Inverse normal |
| T.DIST | Y | Y | Y | Y | M | Student's t CDF |
| T.DIST.2T | Y | Y | Y | Y | S | Two-tailed t |
| T.DIST.RT | Y | Y | Y | Y | S | Right-tailed t |
| T.INV | Y | Y | Y | Y | M | Inverse t |
| T.INV.2T | Y | Y | Y | Y | S | Two-tailed inverse t |
| T.TEST | Y | Y | Y | Y | C | T-test p-value |
| TDIST | Y | Y | Y | Y | S | Legacy alias |
| CHISQ.DIST | Y | Y | Y | Y | M | Chi-squared CDF |
| CHISQ.DIST.RT | Y | Y | Y | Y | S | Right-tailed |
| CHISQ.INV | Y | Y | Y | Y | M | Inverse chi-squared |
| CHISQ.INV.RT | Y | Y | Y | Y | S | Right-tailed inverse |
| CHISQ.TEST | Y | Y | Y | Y | C | Chi-squared test |
| F.DIST | Y | Y | Y | Y | M | F-distribution CDF |
| F.DIST.RT | Y | Y | Y | Y | S | Right-tailed |
| F.INV | Y | Y | Y | Y | M | Inverse F |
| F.INV.RT | Y | Y | Y | Y | S | Right-tailed inverse |
| F.TEST | Y | Y | Y | Y | C | F-test p-value |

### 2B — Other distributions

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| BETA.DIST | Y | Y | Y | Y | M | Beta distribution CDF |
| BETA.INV | Y | Y | Y | Y | M | Inverse beta |
| BINOM.DIST | Y | Y | Y | Y | M | Binomial distribution |
| BINOM.INV | Y | Y | Y | Y | M | Inverse binomial |
| EXPON.DIST | Y | Y | Y | Y | M | Exponential distribution |
| GAMMA | Y | Y | Y | Y | S | Gamma function |
| GAMMA.DIST | Y | Y | Y | Y | M | Gamma distribution CDF |
| GAMMA.INV | Y | Y | Y | Y | M | Inverse gamma |
| GAMMALN | Y | Y | Y | Y | S | ln(gamma(x)) |
| GAMMALN.PRECISE | Y | Y | Y | Y | S | Same as GAMMALN |
| HYPGEOM.DIST | Y | Y | Y | Y | M | Hypergeometric distribution |
| LOGNORM.DIST | Y | Y | Y | Y | M | Lognormal CDF |
| LOGNORM.INV | Y | Y | Y | Y | M | Inverse lognormal |
| NEGBINOM.DIST | Y | Y | Y | Y | M | Negative binomial |
| POISSON.DIST | Y | Y | Y | Y | M | Poisson distribution |
| WEIBULL.DIST | Y | Y | Y | Y | M | Weibull distribution |
| CONFIDENCE.NORM | Y | Y | Y | Y | S | Normal confidence interval |
| CONFIDENCE.T | Y | Y | Y | Y | M | T confidence interval |
| COVARIANCE.P | Y | Y | Y | Y | S | Population covariance |
| COVARIANCE.S | Y | Y | Y | Y | S | Sample covariance |
| SKEW | Y | Y | Y | Y | M | Skewness |
| SKEW.P | Y | Y | Y | Y | S | Population skewness |
| KURT | - | Y | Y | Y | M | Kurtosis |
| Z.TEST | Y | Y | Y | Y | M | Z-test p-value |
| PERCENTILE.INC | - | Y | Y | Y | S | Alias for PERCENTILE |
| PERCENTILE.EXC | - | Y | Y | Y | M | Exclusive percentile |
| PERCENTRANK.INC | - | Y | Y | Y | S | Alias for PERCENTRANK |
| PERCENTRANK.EXC | - | Y | Y | Y | M | Exclusive percentrank |
| QUARTILE.INC | - | Y | Y | Y | S | Quartile (alias) |
| QUARTILE.EXC | - | Y | Y | Y | M | Exclusive quartile |
| MODE.SNGL | - | Y | Y | Y | S | Alias for MODE |
| MODE.MULT | - | Y | Y | Y | M | Multiple modes (array) |

### 2C — Legacy stat aliases (trivial wrappers)

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| BETADIST | Y | - | Y | Y | S | Legacy → BETA.DIST |
| BETAINV | Y | - | Y | Y | S | Legacy → BETA.INV |
| BINOMDIST | Y | - | Y | Y | S | Legacy → BINOM.DIST |
| CHIDIST | Y | - | Y | Y | S | Legacy → CHISQ.DIST.RT |
| CHIINV | Y | - | Y | Y | S | Legacy → CHISQ.INV.RT |
| CRITBINOM | Y | - | Y | Y | S | Legacy → BINOM.INV |
| EXPONDIST | Y | - | Y | Y | S | Legacy → EXPON.DIST |
| FDIST | Y | - | Y | Y | S | Legacy → F.DIST.RT |
| FINV | Y | - | Y | Y | S | Legacy → F.INV.RT |
| GAMMADIST | Y | - | Y | Y | S | Legacy → GAMMA.DIST |
| GAMMAINV | Y | - | Y | Y | S | Legacy → GAMMA.INV |
| HYPGEOMDIST | Y | - | Y | Y | S | Legacy → HYPGEOM.DIST |
| LOGINV | Y | - | Y | Y | S | Legacy → LOGNORM.INV |
| LOGNORMDIST | Y | - | Y | Y | S | Legacy → LOGNORM.DIST |
| NEGBINOMDIST | Y | - | Y | Y | S | Legacy → NEGBINOM.DIST |
| NORMDIST | Y | - | Y | Y | S | Legacy → NORM.DIST |
| NORMINV | Y | - | Y | Y | S | Legacy → NORM.INV |
| NORMSDIST | Y | - | Y | Y | S | Legacy → NORM.S.DIST |
| NORMSINV | Y | - | Y | Y | S | Legacy → NORM.S.INV |
| POISSON | Y | - | Y | Y | S | Legacy → POISSON.DIST |
| STDEVP | Y | - | Y | Y | S | Legacy → STDEV.P |
| VARP | Y | - | Y | Y | S | Legacy → VAR.P |
| TINV | Y | - | Y | Y | S | Legacy → T.INV.2T |
| TTEST | Y | - | Y | Y | S | Legacy → T.TEST |
| FTEST | Y | - | Y | Y | S | Legacy → F.TEST |
| WEIBULL | Y | - | Y | Y | S | Legacy → WEIBULL.DIST |
| ZTEST | Y | - | Y | Y | S | Legacy → Z.TEST |
| CHITEST | Y | - | Y | Y | S | Legacy → CHISQ.TEST |
| VARA | Y | Y | Y | Y | S | VAR with text=0 |
| VARPA | Y | Y | Y | Y | S | VAR.P with text=0 |
| STDEVA | Y | Y | Y | Y | S | STDEV with text=0 |
| STDEVPA | Y | Y | Y | Y | S | STDEV.P with text=0 |

**Batch 2 total: 81 functions** — All implemented with zero external dependencies (special functions in `src/functions/special.rs`).
**Status: COMPLETE** — All 2A distributions, 2B distributions + stats, 2C legacy aliases implemented and tested.

---

## Batch 3 — Database Functions

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| DAVERAGE | - | Y | Y | Y | M | DB average with criteria |
| DCOUNT | - | Y | Y | Y | M | DB count |
| DCOUNTA | - | Y | Y | Y | M | DB count non-empty |
| DGET | - | Y | Y | Y | M | DB single value |
| DMAX | - | Y | Y | Y | M | DB max |
| DMIN | - | Y | Y | Y | M | DB min |
| DPRODUCT | - | Y | Y | Y | M | DB product |
| DSTDEV | - | Y | Y | Y | M | DB sample stdev |
| DSTDEVP | - | Y | Y | Y | M | DB population stdev |
| DSUM | - | Y | Y | Y | M | DB sum |
| DVAR | - | Y | Y | Y | M | DB sample variance |
| DVARP | - | Y | Y | Y | M | DB population variance |

**Batch 3 total: 12 functions** — All share a common criteria evaluation engine. Build criteria engine once, functions are trivial wrappers.

---

## Batch 4 — Complex Number / Engineering Functions

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| COMPLEX | Y | - | Y | Y | S | Create complex number |
| IMREAL | Y | - | Y | Y | S | Real part |
| IMAGINARY | Y | - | Y | Y | S | Imaginary part |
| IMABS | Y | - | Y | Y | S | Absolute value |
| IMARGUMENT | Y | - | Y | Y | S | Angle (argument) |
| IMCONJUGATE | Y | - | Y | Y | S | Conjugate |
| IMCOS | Y | - | Y | Y | S | Complex cosine |
| IMCOSH | Y | - | Y | Y | S | Complex cosh |
| IMCOT | Y | - | Y | Y | S | Complex cotangent |
| IMCSC | Y | - | Y | Y | S | Complex cosecant |
| IMCSCH | Y | - | Y | Y | S | Complex csch |
| IMDIV | Y | - | Y | Y | S | Complex division |
| IMEXP | Y | - | Y | Y | S | Complex e^z |
| IMLN | Y | - | Y | Y | S | Complex ln |
| IMLOG10 | Y | - | Y | Y | S | Complex log10 |
| IMLOG2 | Y | - | Y | Y | S | Complex log2 |
| IMPOWER | Y | - | Y | Y | M | Complex power |
| IMPRODUCT | Y | - | Y | Y | M | Complex product (variadic) |
| IMSEC | Y | - | Y | Y | S | Complex secant |
| IMSECH | Y | - | Y | Y | S | Complex sech |
| IMSIN | Y | - | Y | Y | S | Complex sine |
| IMSINH | Y | - | Y | Y | S | Complex sinh |
| IMSQRT | Y | - | Y | Y | S | Complex sqrt |
| IMSUB | Y | - | Y | Y | S | Complex subtraction |
| IMSUM | Y | - | Y | Y | S | Complex sum (variadic) |
| IMTAN | Y | - | Y | Y | S | Complex tangent |
| BESSELI | Y | - | Y | Y | C | Modified Bessel I |
| BESSELJ | Y | - | Y | Y | C | Bessel J |
| BESSELK | Y | - | Y | Y | C | Modified Bessel K |
| BESSELY | Y | - | Y | Y | C | Bessel Y |
| CONVERT | - | Y | Y | Y | C | Unit conversion (huge lookup table) |
| ERF.PRECISE | - | Y | Y | Y | S | Same as ERF |
| ERFC.PRECISE | - | Y | Y | Y | S | Same as ERFC |

**Batch 4 total: 33 functions** — Complex functions all share a parse/format complex number helper. Bessel functions need special math. CONVERT is large but mechanical.

---

## Batch 5 — Modern Excel 365 / Dynamic Array Functions

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| XMATCH | - | - | Y | Y | M | Enhanced MATCH |
| SORTBY | - | - | Y | Y | M | Sort by helper column |
| CHOOSECOLS | - | - | Y | Y | S | Select columns from array |
| CHOOSEROWS | - | - | Y | Y | S | Select rows from array |
| DROP | - | - | Y | Y | S | Drop rows/cols from array |
| TAKE | - | - | Y | Y | S | Take rows/cols from array |
| EXPAND | - | - | Y | Y | S | Expand array with padding |
| HSTACK | - | - | Y | Y | S | Horizontal stack arrays |
| VSTACK | - | - | Y | Y | S | Vertical stack arrays |
| WRAPCOLS | - | - | Y | Y | S | Wrap vector into columns |
| WRAPROWS | - | - | Y | Y | S | Wrap vector into rows |
| TOCOL | - | - | Y | Y | S | Flatten to column |
| TOROW | - | - | Y | Y | S | Flatten to row |
| TEXTSPLIT | - | - | Y | Y | M | Split text into array |
| TEXTAFTER | - | Y | Y | Y | M | Text after delimiter |
| TEXTBEFORE | - | Y | Y | Y | M | Text before delimiter |
| CONCAT | - | Y | Y | Y | S | (also in Batch 1) |
| LET | - | - | Y | Y | C | Named variables in formula |
| LAMBDA | - | - | Y | Y | C | User-defined functions |
| MAP | - | - | Y | Y | C | Map LAMBDA over array |
| REDUCE | - | - | Y | Y | C | Reduce array with LAMBDA |
| SCAN | - | - | Y | Y | C | Scan array with LAMBDA |
| BYCOL | - | - | Y | Y | C | Apply LAMBDA by column |
| BYROW | - | - | Y | Y | C | Apply LAMBDA by row |
| MAKEARRAY | - | - | Y | Y | C | Generate array via LAMBDA |
| VALUETOTEXT | - | Y | Y | Y | S | Convert value to text |
| ISOMITTED | - | - | Y | Y | S | Check if LAMBDA arg omitted |

**Batch 5 total: 27 functions** — Array manipulation functions are straightforward. LAMBDA/LET/MAP/REDUCE require parser changes (deferred expressions).

---

## Batch 6 — Niche / Less Common

### 6A — Trig & Math

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| ACOSH | Y | Y | Y | Y | S | Inverse hyperbolic cosine |
| ASINH | Y | Y | Y | Y | S | Inverse hyperbolic sine |
| ATANH | Y | Y | Y | Y | S | Inverse hyperbolic tangent |
| ACOT | Y | Y | Y | Y | S | Inverse cotangent |
| ACOTH | Y | Y | Y | Y | S | Inverse hyperbolic cotangent |
| COT | Y | Y | Y | Y | S | Cotangent |
| COTH | Y | Y | Y | Y | S | Hyperbolic cotangent |
| CSC | Y | Y | Y | Y | S | Cosecant |
| CSCH | Y | Y | Y | Y | S | Hyperbolic cosecant |
| SEC | Y | Y | Y | Y | S | Secant |
| SECH | Y | Y | Y | Y | S | Hyperbolic secant |
| CEILING.MATH | - | Y | Y | Y | S | Modern ceiling |
| CEILING.PRECISE | - | Y | Y | Y | S | ISO ceiling |
| ISO.CEILING | - | Y | Y | Y | S | Same as CEILING.PRECISE |
| FLOOR.MATH | - | Y | Y | Y | S | Modern floor |
| FLOOR.PRECISE | - | Y | Y | Y | S | ISO floor |
| AGGREGATE | - | - | Y | Y | C | 19 functions + ignore options |

### 6B — Date/Time

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| NETWORKDAYS.INTL | - | Y | Y | Y | M | Custom weekend mask |
| WORKDAY.INTL | - | Y | Y | Y | M | Custom weekend mask |
| XIRR | - | Y | Y | Y | C | IRR for irregular cashflows (Newton's method) |

### 6C — Text

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| HYPERLINK | Y | - | Y | Y | S | Create hyperlink (returns text in calc engine) |

### 6D — HF-specific / Google Sheets

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| COUNTUNIQUE | Y | - | - | - | S | GSheets function |
| SPLIT | Y | - | - | - | S | GSheets text split |
| INTERVAL | Y | - | - | - | S | HF-specific |
| ISBINARY | Y | - | - | - | S | HF-specific |
| ARRAYFORMULA | Y | - | - | - | S | GSheets wrapper |
| ARRAY_CONSTRAIN | Y | - | - | - | S | GSheets function |
| MAXPOOL | Y | - | - | - | M | HF-specific |
| MEDIANPOOL | Y | - | - | - | M | HF-specific |
| VERSION | Y | - | - | - | S | HF version string |

### 6E — Info

| Function | HF | IC | XL | LO | Complexity | Notes |
|----------|----|----|----|----|------------|-------|
| CELL | - | Y | Y | Y | C | Cell metadata (complex) |
| INFO | - | - | Y | Y | M | System info |

**Batch 6 total: ~35 functions**

---

## Summary

| Batch | Count | Priority | Effort Est. | Key Dependency |
|-------|-------|----------|-------------|----------------|
| 1 — Common Missing | 23 | Highest | 3-4 days | None |
| 2 — Statistical Distributions | ~70 | High | 5-7 days | `statrs` crate for dist math |
| 3 — Database Functions | 12 | Medium | 2 days | Criteria engine (shared) |
| 4 — Complex/Engineering | 33 | Medium | 3-4 days | Complex number parser |
| 5 — Modern Excel 365 | 27 | Low-Med | 5-7 days | LAMBDA/LET need parser work |
| 6 — Niche | ~35 | Low | 3-4 days | Mixed |
| **Total** | **~200** | | **~25 days** | |

## Implementation Notes

### Crate dependencies needed
- **`statrs`** — Beta, Gamma, Chi-squared, F, T, Normal, Binomial, Poisson, etc. distributions. Covers all of Batch 2.
- **`num-complex`** — Complex number arithmetic for Batch 4. Or roll own (just two f64s).

### Shared infrastructure to build first
1. **Complex number parser/formatter** — parse "3+4i" strings, format back. Unlocks all 26 IM* functions.
2. **Database criteria engine** — parse criteria range, match rows. Unlocks all 12 D* functions.
3. **Distribution wrapper layer** — thin wrappers around `statrs` CDF/PDF/inverse. Unlocks ~40 distribution functions.
4. **Legacy alias registry** — map legacy names → modern implementations. Unlocks ~28 aliases for free.

### What NOT to implement (diminishing returns)
- LAMBDA/LET/MAP/REDUCE/SCAN — require fundamental parser changes (deferred evaluation, closures). Only implement if real user demand.
- CELL/INFO — environment-dependent, limited value in server-side calc engine.
- HF-specific functions (MAXPOOL, MEDIANPOOL, VERSION, INTERVAL) — no compatibility value.
- STOCKHISTORY, IMAGE, TRANSLATE, DETECTLANGUAGE — require external services.

### Quick wins (can ship same day)
- TRUE/FALSE (constant functions)
- STDEV.S / VAR.S (aliases for existing STDEV/VAR)
- MAXA / MINA (trivial variant of MAX/MIN)
- ACOSH/ASINH/ATANH/COT/COTH/CSC/CSCH/SEC/SECH (one-liner trig)
- ERF.PRECISE / ERFC.PRECISE (aliases for existing ERF/ERFC)
- GAMMALN (single math call)
- Legacy stat aliases (once modern versions exist)
