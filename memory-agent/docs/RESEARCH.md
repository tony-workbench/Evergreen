# How health apps compare a person with their own baseline

What Apple, Whoop, Oura, Garmin, Strava and Fitbit/Google document, and what we took from it. Items marked unverified were not confirmed in an official page.

## What they do

| Practice | Seen in |
| --- | --- |
| A short recent window (7, 14 or 21 days) against the person's own longer one (28 days; 60 to 90 days for Oura; 90 against 365 for Apple Trends) | All of them |
| A warm-up before any comparison is shown (7 days to 6 months) | Apple, Oura, Whoop, Garmin |
| Ordinal labels: "well below" to "well above" (Apple Training Load), within, below or above range (Strava), recovery and strain bands (Whoop), readiness bands (Oura) | All of them |
| A label paired with advice ("ready", "rest") | All of them |
| Efficacy shown by company cohort studies; independent validation covers sensor accuracy, not the labels | Apple, Whoop; Dial et al. 2025 for sensors |

Unverified: Apple's percentage cutoffs, Whoop's baseline window, Garmin's windows and its 1.5 and 2.0 ratio cutoffs, Strava's 42 and 7 day constants, Fitbit's weekly target formula.

## What we took

- A short window against a 28-day personal baseline, written as numbers and a ratio, never as a label.
- Nothing is compared before 14 days of data; the memory says how many days it has.
- No advice words. The labels above are the part we do not use.

## How we measure the memory

1. Every number in a sentence matches a recomputation from the data.
2. Direction and ratio are right at the exact boundaries.
3. With 3, 7, 14, 28 and 60 days of history, no comparison is written below the minimum.
4. When days are missing, the stated window and count match the days used.
5. One ordinary extra day does not change a stable statement.
6. Planted spikes, drops and shifts are found; steady noise raises none.
7. No sentence contains advice (checked by a lint).
8. Every sentence the planner repeats is supported by a stored fact.

## Sources

- Apple Training Load https://support.apple.com/en-tm/guide/watch/apde4c07a6cf/watchos ; Vitals https://support.apple.com/120142
- Oura https://support.ouraring.com/hc/en-us/articles/360057791533
- Garmin Forerunner 965 manual (training status) https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-8224236E-D732-45DA-BE5B-620E9F0D370F-3127.html
- Strava Fitness and Freshness https://support.strava.com/en-us/articles/15402032-fitness-freshness
- Fitbit Cardio Load https://support.google.com/fitbit/answer/15402655?hl=en
- Google personal health coach https://research.google/blog/how-we-are-building-the-personal-health-coach/
- Independent sensor validation (Dial et al., Physiological Reports 2025) https://pmc.ncbi.nlm.nih.gov/articles/
