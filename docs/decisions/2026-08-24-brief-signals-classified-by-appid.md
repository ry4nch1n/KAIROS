# 2026-08-24 — Brief signals classify by steam_appid, not prose alone

**Decision.** `familyOfItem` gains a third tier: labels → prose → `steam_appid` ⇒ crawled
genre/tags ⇒ `loopFamilyFor` (#163). The brief read now touches the crawl tables — ONE batched
query per edition (`fetchSteamTaxonomy`) over the current AND previous payloads, since folding
them by different rules would fabricate the tracker's direction.

**Why.** A patch note never names its genre, so no vocabulary can place it; the appid is a lookup
against data KAIROS already owns. It runs LAST: it differs from prose only where they disagree.

**Consequence.** Steam's first store genre is usually too broad to map, so the tier falls back to
the crawled TAGS read through the labels vocabulary. Hit rate is logged per run, not assumed.
