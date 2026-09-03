# Roman Empire Imagery — Sources & Licenses

Photographs downloaded for the FolioX landing page (branch `roman-empire`). All files live in `app/public/brand/` as `roman-1.jpg` … `roman-6.jpg`. All are sourced from Wikimedia Commons with verified licenses; all were converted to grayscale (macOS `sips` color-match to Generic Gray profile) and sized under ~800KB.

| File | Size | Subject / Mood | Source page | Direct image URL (original) | License | Photographer |
|---|---|---|---|---|---|---|
| `roman-1.jpg` | 476KB (1920x1280) | Colosseum at night, floodlit against a pure-black sky. Already native black-and-white. A few pedestrians and a small sign at the very bottom edge — crop or overlay-friendly. | https://commons.wikimedia.org/wiki/File:Colosseum_exterior_at_night,_Rome,_Italy_(Ank_Kumar)_03.jpg | https://thumb.wikimedia.org/wikipedia/commons/thumb/1/16/Colosseum_exterior_at_night%2C_Rome%2C_Italy_%28Ank_Kumar%29_03.jpg/1920px-Colosseum_exterior_at_night%2C_Rome%2C_Italy_%28Ank_Kumar%29_03.jpg | CC BY-SA 4.0 | Ank Kumar |
| `roman-2.jpg` | 419KB (1920x1081) | Pantheon dome interior looking straight up at the oculus; glowing light well on dark coffered concrete. Grayscaled from blue-tint original. | https://commons.wikimedia.org/wiki/File:Interior_oculus_of_the_Rome_Pantheon.jpg | https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fc/Interior_oculus_of_the_Rome_Pantheon.jpg/1920px-Interior_oculus_of_the_Rome_Pantheon.jpg | CC BY-SA 4.0 | T. Le Berre |
| `roman-3.jpg` | 620KB (1500x2305) | Marble head of Marcus Aurelius, Archaeological Museum of Heraklion; warm-lit bust on a dark museum wall. Grayscaled + resized from 1920px original. | https://commons.wikimedia.org/wiki/File:Head_Marcus_Aurelius_archmus_Heraklion.jpg | https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f8/Head_Marcus_Aurelius_archmus_Heraklion.jpg/1920px-Head_Marcus_Aurelius_archmus_Heraklion.jpg | CC0 | Jebulon |
| `roman-4.jpg` | 412KB (1500x2250) | Augustus of Prima Porta (Vatican Museums), full statue with raised arm on a slate-gradient studio background. Grayscaled from color original. | https://commons.wikimedia.org/wiki/File:Statue-Augustus.jpg | https://upload.wikimedia.org/wikipedia/commons/e/eb/Statue-Augustus.jpg | Public domain | Till Niermann |
| `roman-5.jpg` | 644KB (1920x2560) | Marble portrait of Empress Faustina the Younger (MET open access); veiled bust on a near-black background — ideal dark-page material. Grayscaled from color original. | https://commons.wikimedia.org/wiki/File:Marble_portrait_of_the_Empress_Faustina_the_Younger,_wife_of_the_emperor_Marcus_Aurelius_MET_DP333693.jpg | https://thumb.wikimedia.org/wikipedia/commons/thumb/0/05/Marble_portrait_of_the_Empress_Faustina_the_Younger%2C_wife_of_the_emperor_Marcus_Aurelius_MET_DP333693.jpg/1920px-Marble_portrait_of_the_Empress_Faustina_the_Younger%2C_wife_of_the_emperor_Marcus_Aurelius_MET_DP333693.jpg | CC0 (Metropolitan Museum of Art Open Access) | Metropolitan Museum of Art |
| `roman-6.jpg` | 352KB (1400x1312) | Trajan's Column shaft — spiral carved frieze against plain sky. Cropped (top 1800px band, offset y=1350) to remove modern buildings/street lamps at the base and the modern balcony railing at top, then grayscaled. A faint hairline lightning-rod wire on the left edge is barely visible. | https://commons.wikimedia.org/wiki/File:Trajan%27s_Column_HD.jpg | https://thumb.wikimedia.org/wikipedia/commons/thumb/6/65/Trajan%27s_Column_HD.jpg/1920px-Trajan%27s_Column_HD.jpg | CC BY-SA 4.0 | Livioandronico2013 |

## Hero recommendation

**`roman-1.jpg` (night Colosseum)** is the strongest hero for a near-black page: it is natively black-and-white, the floodlit stonework reads crisply against a genuinely black sky, and the composition leaves dark negative space at the top for headline text. Apply a subtle bottom fade/overlay to hide the few pedestrians and sign at the base. Runner-up: `roman-5.jpg` (Faustina bust) for a statuary-focused hero — it is shot on an almost pure-black studio background (CC0, no attribution required).

## License notes

- **CC0 / Public domain** (`roman-3`, `roman-4`, `roman-5`): no attribution required; safe for commercial use.
- **CC BY-SA 4.0** (`roman-1`, `roman-2`, `roman-6`): attribution required (credit photographer, link to the Commons file page) and share-alike applies to the adapted image. If attribution on the page is undesirable, prefer the CC0/PD set — `roman-5` is the strongest stand-alone hero alternative.

---

# Hero watermark — Pantheon engraving (2026-09-03)

`pantheon-engraving.jpg` in `app/public/brand/` — used as a barely-visible watermark layer BEHIND the hero text on the landing page (not a framed photo). Downloaded at 1920px via the Commons thumbnail API, resized to 1600x1093, recompressed to 671KB. Already grayscale natively (single-channel JPEG scan).

| Field | Value |
|---|---|
| File | `app/public/brand/pantheon-engraving.jpg` (671KB, 1600x1093) |
| Subject | Francesco Piranesi, *Veduta del Pantheon d'Agrippa oggi Chiesa di S. Maria ad Martyres* (1790) — full facade + dome + piazza figures under a dramatic etched sky; landscape plate, composes well wide |
| Source page | https://commons.wikimedia.org/wiki/File:Piranesi-6023.jpg |
| Direct image URL (original) | https://upload.wikimedia.org/wikipedia/commons/7/72/Piranesi-6023.jpg |
| Thumbnail URL used | https://thumb.wikimedia.org/wikipedia/commons/thumb/7/72/Piranesi-6023.jpg/1920px-Piranesi-6023.jpg |
| License | Public domain (`{{PD-old}}`, 18th-century etching; no attribution required) |

## Treatment note

The plate is dark ink on light paper; on the near-black page it is rendered with CSS `invert(1) grayscale(1) contrast(1.06)` at `opacity: 0.16`, so only the etched strokes survive as faint light lines and the paper dissolves into the background. Top/bottom + left/right `linear-gradient` masks in `hsl(var(--background))` fade all four edges into the page.
