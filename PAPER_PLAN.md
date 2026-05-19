# Paper Plan — Browser-Based Gaze + SAM Annotation for Surgical Video

> Living planning document. Update as decisions are made.

**Target venue (primary)**: HAIC-MICCAI 2026 (2nd Workshop on Human-AI Collaboration), pending deadline confirmation
**Format**: workshop paper, ~4–8 pages
**Status**: outline / pre-pilot
**Last updated**: 2026-05-19 (GazeMedSeg-style heatmap aggregation + fixation filtering implemented in [src/gazeBuffer.ts](src/gazeBuffer.ts) and wired into LabelMode)

---

## 1. North-star one-paragraph story

> Surgical AI's bottleneck is annotation cost — expert surgeon time is expensive and
> doesn't scale with the dataset sizes modern models need. We present a browser-based,
> zero-install tool that turns a surgeon's natural review behaviour (looking + speaking)
> into structured multimodal annotations: webcam gaze prompts SAM for instance-level
> masks, audio captures verbal reasoning, and fixation / AOI / scanpath metrics are
> emitted out-of-the-box. In a pilot with **N** surgical trainees on **M** Cholec80
> clips, gaze+SAM annotation was **X×** faster than polygon drawing with **Y%** IoU
> against a reference standard. We open-source the tool and a paired benchmark harness.

Everything in this plan should serve that paragraph. Anything that doesn't, cut it.

---

## 2. Title candidates

- **GazeLab**: In-Browser Gaze + Audio Annotation of Surgical Video
- **Look-and-Label**: Webcam-Gaze SAM Prompting for Scalable Surgical Annotation
- **Annotation by Attention**: A Browser-Based Multimodal Tool for Surgical Video

Pick a ≤5-word version that fits a tweet. Final by week 5.

---

## 3. Contribution claim (the "three bullets")

GazeSAM (Wang et al., NeurIPS 2023 Gaze Meets ML Workshop) already does
"gaze-prompted SAM for medical imaging" with a Tobii Pro Nano on natural
images + LiTS liver CT. Quantitative results: **125 vs 232 s on GrabCut,
266 vs 424 s on Berkeley** (~46 % time saved, mIoU −0.2 % to −2.8 % vs
mouse-SAM baseline). **Their evaluation used a single annotator with no
NASA-TLX and a single mouse baseline.** See [related_work.md §A.2](related_work.md#a2--gazesam--what-you-see-is-what-you-segment).

Our contribution does **not** rest on the gaze→SAM idea itself; it rests on
four distinct axes, each defensible on its own:

1. **System** — first **browser-based, hardware-free** workflow combining
   webcam gaze, SAM, **synchronised audio commentary**, and built-in
   eye-tracking analytics (fixation / AOI / scanpath / dwell / TTFF) for
   **surgical video** annotation. GazeSAM is hardware-locked (Tobii) + Python
   desktop + still images (natural + 3D radiology slices).
2. **Empirical** — a pilot with **≥3 surgical trainees**, **NASA-TLX**, and
   **multiple baselines** (polygon, bbox, gaze+SAM) on surgical video.
   GazeSAM's evaluation does **none** of these — it is **N = 1, one baseline
   (mouse-SAM), natural images only**. Our evaluation rigor alone is a
   defensible contribution.
3. **Open** — open-source tool + a paired benchmark harness for comparing
   webcam gaze pipelines (v1 / v2 / future), with a comparable JSON schema
   across pipelines.

**Do not** use the word "first" without a qualifier. Defensible qualified
forms (per [related_work.md cluster summary](related_work.md#cluster-summary-table)):
- "First **webcam + browser** gaze annotation for **medical / surgical**
  imaging" (TurkerGaze 2015 owns natural-image saliency; medical-gaze work
  all uses lab eye trackers)
- "First gaze + SAM annotation tool for **surgical video**" (all prior
  gaze+SAM work is still images or volume slices)
- "First **multimodal (gaze + audio + segmentation)**" annotation tool in
  any medical/surgical context
- "First **multi-participant + NASA-TLX evaluation**" of a gaze-prompted-SAM
  tool

**Forbidden** unqualified claims (will get caught by reviewers):
- ~~"First webcam gaze annotation"~~ → TurkerGaze 2015
- ~~"First gaze annotation in medical imaging"~~ → Gaze2Segment 2016
- ~~"First gaze + SAM"~~ → GazeSAM 2023
- ~~"First gaze dataset for medical segmentation"~~ → GazeMedSeg already
  owns this exact wording (MICCAI 2024)

**Numbers to beat / report against in §4.5**: time-saving of GazeSAM on
natural images was ~46 %. We should expect smaller savings on surgical
video (harder imagery, smaller gain over already-fast bbox baseline), and
we **gain credibility** by reporting workload/IoU honestly rather than
overclaiming.

---

## 4. Section-by-section outline

### 4.1 Introduction (~1 page)
- Hook: surgical AI dataset cost — cite Cholec80 / EndoVis annotation effort numbers
- Gap: polygon = slow; lab eye trackers = expensive and don't deploy; bbox = too coarse
- Insight: a surgeon's gaze + narration *is* the annotation if structured
- Three contribution bullets (from §3)

### 4.2 Related Work (~0.75 page)
Search-and-position three clusters (do this FIRST — see §5):
- Eye tracking in surgery / surgical training (lots of Tobii-based)
- Webcam gaze tracking (WebGazer + descendants)
- SAM in surgical / medical imaging (MedSAM, SurgicalSAM, SurgSAM-2)
- Gaze-prompted segmentation (GazeSAM-style — **risk node**)

### 4.3 System (~2.5 pages, the meat)
- Architecture diagram (formalised version of [README.md](README.md) ASCII)
- Pipeline: webcam → gaze pipeline → SAM prompt → mask → label + AOI sync
- Two modes: still-image label, video annotation with audio
- **Pick ONE technical callout** (decide by end of week 2):
  - **(a)** v2 dual-model auto-correction — only if v2 benchmark wins clearly
  - **(b)** Webcam-grade gaze sufficiency for SAM region-prompting (precision delegated to SAM), enabled by **streaming Gaussian-heatmap aggregation adapted from Zhong et al. (MICCAI 2024)** — implemented in [src/gazeBuffer.ts](src/gazeBuffer.ts); fixation filtering follows GazeMedSeg rules (drop out-of-bounds, require ≥50 ms dwell)
  - **(c)** Multimodal synchronisation engineering (gaze + audio + frame timestamps)
- Implementation: Vite + ONNX Runtime Web + WebGazer/custom + MediaRecorder

### 4.4 Technical Evaluation (~1 page)
Plug in numbers from the benchmark harness ([bench/](bench/)):
- 5×5 grid accuracy: v1 vs v2 over N users (° error, jitter)
- 5-minute drift: v1 vs v2 (°/min)
- Takeaway sentence: "≈ 2° steady-state suffices as a SAM region prompt"

### 4.5 Pilot User Study (~1.5 pages) — **the credibility gate**
- Design: within-subjects, 3–5 participants, PGY-2+ surgical trainees
- Stimuli: 3 Cholec80 clips × 30 s each, randomised condition order
- Conditions: polygon / bounding box / gaze+SAM
- Metrics:
  - annotation time per frame (s)
  - mask IoU vs senior-attending reference
  - NASA-TLX (60-second subjective workload questionnaire)
  - 3-question semi-structured interview: best / worst / would-you-use
- Results: one table + one boxplot

### 4.6 Discussion + Limitations (~0.75 page)
Be **honest**: this section earns reviewer trust.
- Webcam accuracy ceiling
- SAM weaknesses in surgical imagery (smoke / blood / tool occlusion)
- No real OR deployment yet
- Pilot N is small; no statistical claims, only effect-size suggestions
- Single anatomical site (laparoscopic cholecystectomy)

### 4.7 Conclusion + Future Work (~0.5 page)
- OR deployment trial
- MedSAM / SurgicalSAM backbone
- Phase labelling mode (more standard surgical task than instance segmentation)

---

## 5. Prior-work search

Notes live in [related_work.md](related_work.md). Status per cluster:

| Cluster | Coverage |
|---|---|
| A. Gaze-prompted segmentation (medical) | ✅ GazeSAM **NeurIPS 2023** PDF read end-to-end (numbers + study design + acknowledged limitations all extracted). Bagci-lab 8-year thread identified (Gaze2Segment 2016 → c-CAD 2019 → GazeSAM 2023). |
| B. Webcam / browser gaze tracking | ✅ WebGazer baseline + webcam-vs-Tobii accuracy literature surveyed. Negative result confirmed: no prior webcam gaze in surgical contexts. |
| C. SAM variants for surgical / medical | ⏳ MedSAM, SurgicalSAM, SurgSAM-2, SAM-Track not yet surveyed. |
| D. Surgical eye tracking + annotation tooling | ✅ 6 entries: Wisely ophthalmic platform (closest anchor), Wu robotic workload, EgoSurgery-Phase, Gaze-Guided Activity Recognition, GazeCode, Gazealytics. |

**Key finding from survey**: nobody else occupies our row in the
webcam × browser × video × multimodal × annotation matrix
(see [related_work.md](related_work.md) cluster summary table).

**Hard gate**: do not draft sections 1, 3, or 6 until cluster C has ≥3
entries (need it to defend MobileSAM choice + future-work paragraph).

---

## 6. Empirical claims: what we can vs can't say today

| Can claim now | Evidence |
|---|---|
| Tool exists and is functional | repo + demo videos |
| Zero install, browser only | live URL + README |
| Implements fixation / AOI / scanpath | [src/gazeAnalysis.ts](src/gazeAnalysis.ts) |
| Multimodal sync (gaze + audio + frame) | [src/videoMode.ts](src/videoMode.ts) |
| Gaze accuracy X°, drift Y°/min | **needs benchmark run** ([bench/](bench/)) |

| Cannot claim yet | Required work |
|---|---|
| Faster than polygon | pilot timing data |
| IoU ≥ X% vs reference | pilot + gold-standard reference annotations |
| Surgeons find it useful | NASA-TLX + interviews |
| v2 > v1 | run [bench/](bench/) harness on both |
| Generalises across procedure types | multiple datasets (out of scope for pilot) |

---

## 7. Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Can't recruit surgical participants | High | Plan B (§9) |
| GazeSAM-style prior work covers our angle | ~~Medium~~ **Confirmed** | GazeSAM (2023) exists; framing already revised in §3 to deployment + video + multimodal + analytics. Cite + position; do not claim unqualified "first". |
| MobileSAM unusable on surgical imagery | Medium | Swap weights to MedSAM/SurgicalSAM (only [src/sam.ts](src/sam.ts) changes) |
| v2 benchmark loses to v1 | Medium | Don't push v2 as the contribution; pick technical callout (b) or (c); paper uses whichever pipeline wins |
| Cholec80 licence / IRB process | Low | Cholec80 is public research dataset; pilot scope likely IRB-exempt or expedited |
| HAIC-MICCAI deadline not actually in July | Medium | Confirm via email by end of week 1; fall back to Plan B venues |

---

## 8. Decision points (resolve this week)

1. **Clinical collaborator** — can I get at least one surgical
   resident / fellow committed within 1 week?
   → **Yes**: pursue HAIC-MICCAI track
   → **No**: switch to Plan B (§9) immediately
2. **Benchmark run** — v1 vs v2 numbers from [bench/](bench/) harness.
   → Tells us whether v2 is the technical headline or whether we pivot to
     callout (b) / (c)
3. ~~**Prior-work search** — GazeSAM and friends.~~
   **DONE (partial)**: GazeSAM surveyed → reframed in §3. Remaining clusters
   (B / C / D) still to do — track in [related_work.md](related_work.md).

---

## 9. Plan B — no clinical collaborator

Reframe as a **general expert video annotation tool**, validated with
non-surgical experts (radiology trainees, sports analysts, computer vision
researchers reviewing benchmark footage).

Alternative venues, in order of fit:
- **ETRA 2027** — eye tracking community, lower bar for tool papers
- **MIDL 2027** — medical imaging + DL, accepts tool / dataset papers
- **CHI 2027 Late-Breaking Work** — 4 pages, HCI community, lowest bar
- **IEEE VR 2027** — if gaze interaction angle is emphasised

The story stays the same; the validation population and venue framing change.

---

## 10. Six-week timeline (if HAIC-MICCAI ~July deadline holds)

| Week | Focus | Concrete deliverable |
|---|---|---|
| 1 | Finish prior-work search (clusters B/C/D in [related_work.md](related_work.md)); confirm HAIC deadline; reach out to clinical collaborators | full `related_work.md`; go/no-go on Plan A vs B |
| 2 | Run benchmark v1 vs v2; swap MedSAM weights into [src/sam.ts](src/sam.ts) | Technical evaluation numbers; chosen technical callout (a/b/c) |
| 3 | Pilot study design; IRB filing (if required); participant scheduling | Study protocol PDF; scheduled sessions |
| 4 | Run pilot (3–5 participants × ~30 min); collect TLX + interviews | Raw timing / IoU / TLX data |
| 5 | Analyse data; write full draft; produce figures | Complete first draft |
| 6 | Internal review; revisions; submission | Submitted paper |

**Critical path**: weeks 3–4 (pilot). If no collaborator by end of week 1, abandon HAIC-MICCAI and recompute timeline against Plan B venues.

---

## 11. Open questions (track resolutions here)

- [ ] HAIC-MICCAI 2026 paper deadline — confirm with organizers
- [x] ~~Read GazeSAM PDF~~ → ✅ done; canonical venue is **NeurIPS 2023 Gaze Meets ML Workshop**, not MIDL; key numbers in [related_work.md §A.2](related_work.md#a2--gazesam--what-you-see-is-what-you-segment)
- [ ] Survey cluster C (MedSAM / SurgicalSAM / SurgSAM-2 / SAM-Med2D + An Wang 2023 "SAM Meets Robotic Surgery") — needed before SAM-choice paragraph in §4.3
- [ ] IRB requirement for ≤5-participant tool-evaluation pilot (institution-dependent)
- [ ] Which SAM backbone gives best Cholec80 quality on a 2020-era MacBook GPU
- [ ] Whether to include phase labelling in this paper or save for v2
- [ ] Audio analysis: do we transcribe + analyse, or just preserve as evidence?

---

## 12. What this plan deliberately excludes

Cut to keep scope honest:
- Head-pose robustness study (separate paper)
- Real OR deployment (future work)
- Multiple surgical specialties (future work)
- Comparison with lab-grade eye trackers (would strengthen but require equipment access)
- Replay-based v1↔v2 head-to-head on identical webcam frames (good idea, separate work)

These are good ideas; they belong in a journal extension, not the workshop submission.
