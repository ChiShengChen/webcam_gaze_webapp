# Related Work — Survey Notes

> Living file. One entry per surveyed paper / system. Each entry ends with a
> **Differentiation** line — what our work does that this one does not.
> When this file has ~8–12 entries across the three clusters in
> [PAPER_PLAN.md §5](PAPER_PLAN.md#5-prior-work-search), the related-work
> section can be drafted directly from it.

Status legend: ✅ surveyed · ⏳ pending · 🔥 must-cite

---

## Cluster A — Gaze-prompted segmentation in medical imaging

There is a **clear 8-year research thread from the Bagci lab** here:
Gaze2Segment (2016) → GazeSAM arXiv (2023) → GazeSAM MIDL (2024). All three
must be cited and positioned carefully. None of them target surgical *video*
or use webcam.

### A.1 🔥 Gaze2Segment (Khosravan, Bagci et al., 2016) — the prototype
- **Citation**: arXiv:1608.03235, MICCAI 2016 workshop
- **Scope**: integrate eye-tracking into **medical image segmentation pipelines**,
  specifically **lung CT** segmentation. Pre-SAM era.
- **Method**: build a visual attention map from gaze samples + fuse with a
  saliency map from the CT → initialise automatic delineation. No deep
  learning prompt model.
- **Results**: 86% Dice, 1.45 mm Hausdorff distance on lung CT.
- **Self-claim**: "first true integration of eye-tracking technology into a
  medical image segmentation task without the need for any further
  user-interaction."
- **Status**: ✅ abstract surveyed; ⏳ PDF for hardware / N participants.
- **Why relevant**: establishes the Bagci-lab line of work; shows the original
  problem framing (radiology, not surgery; static CT, not video) was set in 2016.

### A.2 🔥 GazeSAM — What You See is What You Segment
- **Authors**: Bin Wang, Armstrong Aboah, Zheyuan Zhang, **Hongyi Pan**, Ulas Bagci
  (all Northwestern University — Bagci lab)
- **Two versions**:
  - arXiv:2304.13844 (April 2023) — earlier draft, 4 authors
  - **PMLR v226 (Wang et al. 2023) — NeurIPS 2023 "Gaze Meets ML" Workshop** —
    5 authors (added Hongyi Pan), extended evaluation. **This is the canonical
    peer-reviewed version to cite.**
- **Repo**: https://github.com/ukaukaaaa/GazeSAM (surveyed locally)
- **Scope**: real-time gaze-prompted segmentation. **Quantitative on 2D natural
  images only** (GrabCut + Berkeley); **3D medical (LiTS) is qualitative only**.
- **Stack**:
  - Hardware: **Tobii Pro Nano** (170 mm, 59 g, **60 Hz** sampling, ~$2–3k USD)
  - 5-point calibration in Tobii Pro manager; **60 cm viewing distance**
  - Software: Python + PyQt5 desktop application
  - Model: original SAM (ViT-H/L/B, ~600 MB) via PyTorch
- **Two prompt modes**: "All Points" (whole gaze trajectory) vs "One Point"
  (last gaze sample only)
- **Datasets evaluated**:
  - GrabCut (Rother 2004) — 50 natural images, 1 object each
  - Berkeley (Martin 2001) — 100 natural images
  - LiTS (Bilic 2023) — 3D liver tumor, **qualitative only, no numbers reported**
  - **No surgical video. No medical 2D datasets quantitatively.**
- **Reported results (Table 1 of the paper)**:
  | Model | GrabCut Time/s | GrabCut mIoU% | Berkeley Time/s | Berkeley mIoU% |
  |---|---|---|---|---|
  | **GazeSAM** | **125** | 92.10 | **266** | 85.56 |
  | SAM + Mouse | 232 | 92.31 | 424 | **88.33** |
  - ~46% time reduction (their headline "nearly 50%" claim)
  - mIoU slightly **lower** than mouse baseline on Berkeley (−2.77%);
    comparable on GrabCut (−0.21%)
  - They label this "comparable accuracy"; reviewer-honest reading is
    "small accuracy trade-off for ~half the time"
- **What their evaluation does NOT include** (these are leverage points for us):
  - **No participant count stated** — uses singular "the annotator" throughout.
    Looks like 1 annotator (likely an author). No multi-rater study.
  - **No NASA-TLX or workload metric**
  - **No comparison to polygon, scribble, or bbox baselines** — only one mouse
    baseline (click-based SAM)
  - **No surgical video** (only natural images + liver CT qualitative)
  - **No expertise-stratified comparison** (radiologist vs novice etc.)
  - **No inter-rater agreement** (because N = 1)
- **Limitation they acknowledge** (§4.4 last paragraph): SAM trained on natural
  images, accuracy on medical limited; "fine-tuning SAM on a large-scale medical
  image dataset is a possible solution" → cites MedSAM (Ma & Wang 2023) and
  SAM-Med2D (Cheng 2023) as future work (= our cluster C).
- **Differentiation from this work** (the matrix that defines our novelty):
  1. **Deployment**: webcam + browser (hardware-free, zero install) vs. Tobii + Python desktop
  2. **Modality**: surgical *video* with temporal annotation vs. natural / radiology stills
  3. **Multimodal**: gaze + synchronised audio commentary vs. gaze only
  4. **Analytics**: fixation / AOI / scanpath / TTFF / dwell built-in vs. mask-save only
  5. **Evaluation rigor**: multi-participant + NASA-TLX + multi-baseline (polygon /
     bbox / gaze-SAM) on Cholec80, vs. 1 annotator + 1 baseline on GrabCut/Berkeley
- **Cite both**: arXiv version (sets the priority date) + NeurIPS workshop
  version (peer-reviewed numbers).
- **Status**: ✅ fully surveyed (PDF read end-to-end).

### A.3 Khosravan et al. 2019 — c-CAD with eye tracking
- **Citation**: Khosravan, Celik, Turkbey, Jones, Wood, Bagci (2019).
  "A collaborative computer aided diagnosis (c-CAD) system with eye-tracking,
  sparse attentional model, and deep learning." *Medical Image Analysis* 51:101–115.
- **Status**: ⏳ not yet read (cited by GazeSAM as predecessor work in
  eye-tracking + medical imaging from same lab).
- **Why relevant**: third entry in the Bagci-lab eye-tracking-for-radiology
  thread (2016 → 2019 → 2023). Establishes lineage continuity.

### A.4 🔥 GazeMedSeg (Zhong et al., MICCAI 2024)
- **Citation**: Zhong, Tang, Yang, Qi, Zhou, Gong, Heng, Hsiao, Dou.
  "Weakly-supervised Medical Image Segmentation with Gaze Annotations."
  MICCAI 2024. arXiv:2407.07406. CUHK + HKUST.
- **Repo**: https://github.com/med-air/GazeMedSeg (surveyed locally)
- **Stack**:
  - Hardware: **SR Research Experiment Builder** = **EyeLink** lab-grade
    eye tracker (~$30k+ USD; the most expensive class in the industry).
    **NOT webcam, NOT browser.**
  - Software: PyTorch training pipeline + offline gaze processing notebooks.
- **Scope**: **method paper + dataset paper, NOT a tool paper.** Trains
  weakly-supervised segmentation networks from gaze-derived pseudo-masks
  (multi-level + cross-level consistency).
- **Datasets contributed**: GazeMedSeg = **gaze annotations on top of**
  Kvasir-SEG (1000 polyp endoscopy images) + NCI-ISBI (789 prostate MR
  slices). **Still images, not video.**
- **Headline claim**: "first gaze dataset for medical image segmentation".
  This is a **dataset-level "first"**, not a tool-level "first" — different
  claim space from ours.
- **Results**: Dice 78.86 (Kvasir-SEG polyp), 79.20 (NCI-ISBI prostate)
  with their weakly-supervised method. Argues gaze annotation beats other
  label-efficient schemes in performance + time.
- **Differentiation from this work**:
  1. **Stack**: webcam + browser vs EyeLink + Python. Massive deployment
     gap.
  2. **Paper type**: tool/system paper vs method + dataset paper. We build,
     they train.
  3. **Domain**: surgical *video* annotation vs still images (endoscopy
     polyp + prostate MR).
  4. **Use of gaze**: real-time AI prompting (gaze → SAM mask) vs offline
     pseudo-mask generation for weak supervision training.
  5. **Multimodal**: gaze + audio vs gaze only.
  6. **"First" claim**: their "first" is about a dataset; ours is about a
     tool/workflow. No collision.
- **Why must-cite**: most recent peer-reviewed medical-gaze-segmentation
  paper at MICCAI itself. Reviewers WILL ask how we compare.
- **Status**: ✅ repo + README surveyed.

### A.5 Gaze-Assisted Medical Image Segmentation (2024)
- **Citation**: arXiv:2410.17920
- **Scope**: fine-tune MedSAM with gaze prompts on abdominal CT (WORD
  database, 120 CT scans, 16 abdominal organs). Method paper.
- **Hardware**: not yet confirmed (TODO from PDF read).
- **Status**: ⏳ scan abstract only; need methodology section.

### A.6 Zero-Shot Gaze-based Volumetric Medical Image Segmentation (2025)
- **Citation**: arXiv:2505.15256
- **Scope**: MedSAM-2 + gaze for 3D volumetric medical segmentation,
  zero-shot.
- **Status**: ⏳ not yet read; recent and directly relevant — adds gaze to
  the SAM-2-medical line.

---

## Cluster B — Webcam / browser-based gaze tracking

Pattern of findings: webcam tracking accuracy has narrowed the gap with
IR eye trackers under stable conditions, but real-world deployments in
medical/surgical contexts are essentially absent. **Good news** for our
positioning.

### B.1 🔥 TurkerGaze (Xu, Ehinger, Zhang, Finkelstein, Kulkarni, Xiao — 2015)
- **Citation**: arXiv:1504.06755, Princeton Vision Group
- **Repo**: https://github.com/PrincetonVision/TurkerGaze (surveyed locally)
- **This is our project's direct ancestor in terms of stack** — webcam +
  browser + JavaScript, deployed on Amazon Mechanical Turk for crowdsourced
  gaze data collection. Predates WebGazer.js by ~1 year.
- **Stack**:
  - Hardware: **webcam** (any participant's machine)
  - Webcam lib: **`webcamjs`** (`src/index.js` line 1: `require('script!webcamjs')`)
  - Browser-based JavaScript (`index.html`, `bundle.js`, npm + webpack)
- **Task**: free-viewing of natural images + memory test, then a saliency
  dataset is collected from fixation aggregation. **Not annotation in the
  segmentation sense — saliency/AOI heatmap collection.**
- **Scope it does NOT cover**:
  - No segmentation, no AI prompting (SAM is from 2023, 8 years later)
  - No medical / surgical context
  - No multimodal (no audio, no SAM, just gaze)
  - Game-style stimulus presentation, not workflow-integrated annotation
- **Differentiation from this work**:
  1. **Task type**: saliency dataset collection vs interactive annotation +
     AI segmentation prompting
  2. **Domain**: natural images crowdsourced vs surgical video reviewed by
     domain experts
  3. **Output**: gaze heatmaps for saliency models vs structured segmentation
     masks + AOI metrics + audio
  4. **Modality**: gaze only vs gaze + audio
- **Why must-cite**: establishes that webcam + browser gaze data collection
  has been viable since 2015. Our novelty cannot be "we put gaze tracking in
  a browser" — it must be **what we do with that gaze in the surgical
  workflow**. Use TurkerGaze to bound the "first" claim away from the stack
  and toward the application.
- **Status**: ✅ fully surveyed (repo + README).

### B.2 WebGazer.js (Papoutsaki et al., IJCAI 2016)
- **Citation**: Papoutsaki et al., "WebGazer: Scalable Webcam Eye Tracking
  Using User Interactions," IJCAI 2016
- **Site**: https://webgazer.cs.brown.edu/
- **Scope**: browser-based webcam eye tracker. JavaScript, client-side,
  self-calibrating via clicks. Open-source since Feb 2016, no longer
  guaranteed updates as of Feb 2024.
- **Relationship to TurkerGaze**: WebGazer succeeded TurkerGaze's `webcamjs`
  approach with a more sophisticated ridge-regression-on-eye-features pipeline
  and self-calibration via natural mouse interactions.
- **Relevance**: building block — v1 of this project uses it. Not a
  competing application.
- **Status**: ✅ widely surveyed (used in v1).

### B.3 WebQAmGaze (Ribeiro et al.)
- **Repo**: https://github.com/tfnribeiro/WebQAmGaze
- **Scope**: multilingual low-cost eye-tracking dataset collected via
  WebGazer in browser.
- **Status**: ⏳ to read; relevant as recent (2023+) demonstration that
  WebGazer-based data collection is research-credible.

### B.4 🔥 Brandl et al. — Webcam Gaze as Alternative for Rationale Annotation
- **Citation**: Brandl, Eberle, Ribeiro, Søgaard, Hollenstein.
  "Evaluating Webcam-based Gaze Data as an Alternative for Human Rationale
  Annotations." **LREC-COLING 2024**. arXiv:2402.19133.
- **Task**: multilingual (English / Spanish / German) information-seeking QA;
  the rationale-annotation task is highlighting input *text spans* that
  explain a model's answer. Tests whether webcam gaze can substitute the
  human-highlighted ground truth used to evaluate explainability methods.
- **Stack**:
  - Hardware: **webcam** (library not stated in abstract; likely WebGazer
    given Tiago Ribeiro authored the WebQAmGaze dataset using WebGazer).
  - Domain: **text only**, no images.
- **Finding**: webcam gaze data yields "a comparable ranking of
  explainability methods to that of human rationales" → webcam gaze is a
  **credible substitute** for manual rationale labels in NLP.
- **Differentiation from this work**:
  1. **Modality**: text/NLP vs medical/surgical *images and video*
  2. **Task**: span-highlight rationale vs mask/region segmentation
  3. **No AI prompt integration**: they use gaze as label, we use gaze as
     prompt into SAM
- **Why must-cite**: a peer-reviewed (LREC-COLING) 2024 paper proving that
  webcam-grade gaze data is **research-credible as annotation supervision**.
  This is the strongest single citation for legitimising our "webcam is good
  enough" premise. Use it in §1 / §4 when justifying that lab-grade hardware
  is not required for our use case.
- **Status**: ✅ surveyed (abstract); ⏳ PDF for participant N + correlation
  numbers if we want to quote specifics.

### B.5 Webcam vs. Tobii accuracy benchmarks
A small but consistent literature reports webcam gaze accuracy of **~0.9°–2°
under stable conditions**, vs. ~0.5° for desktop IR trackers like Tobii T60.
Representative findings:
- Webcam: **2–5°** when participant is moving (older estimate)
- Webcam: **0.88°** vs. Mirametrix 1.34° vs. Tobii T60 0.67° in a controlled
  study (PMC source)
- Webcam-based gaze estimation paper (PMC11019238, 2024) confirms further
  narrowing
- **Implication for our paper**: ~2° is a defensible webcam accuracy ceiling
  for a region-prompt task; SAM provides the pixel-level precision.
- **Status**: ✅ background surveyed; ⏳ pick one canonical citation when
  drafting.

### B.6 Webcam eye tracking in clinical / surgical contexts
- **Result**: essentially nothing comes up. The closest hits are general
  validation papers (B.2) and lab-based clinical psychology / cognitive
  science work using webcams to recruit COVID-era remote participants.
- **Implication**: this is the gap we are filling. "Webcam gaze in surgical
  annotation" has no direct prior art that I can find.
- **Status**: ✅ negative-result search done; flag if reviewer points us to
  something we missed.

---

## Cluster C — SAM variants for surgical / medical imagery

Drop-in candidates for [src/sam.ts](src/sam.ts) if MobileSAM underperforms on
surgical imagery.

### C.1 MedSAM
- **Repo**: https://github.com/bowang-lab/MedSAM
- **Status**: ⏳ not yet surveyed
- **Relevance**: candidate weight swap if MobileSAM fails on surgical imagery
  (smoke / blood / tool occlusion).

### C.2 SurgicalSAM
- **Repo**: https://github.com/wenxi-yue/SurgicalSAM
- **Status**: ⏳ not yet surveyed

### C.3 SurgSAM-2
- **Status**: ⏳ not yet surveyed (video-capable SAM-2 derivative)
- **Relevance**: SAM-2 has video support — directly relevant if we want
  mask propagation across video frames.

### C.4 An Wang et al. 2023 — "SAM Meets Robotic Surgery"
- **Citation**: An Wang, Islam, Xu, Zhang, Ren (2023). "SAM meets robotic
  surgery: An empirical study in robustness perspective." arXiv:2304.14674.
- **Status**: ⏳ not yet read
- **Why relevant**: empirical study of SAM (likely original SAM) on robotic
  surgical imagery — **directly tells us how off-the-shelf SAM behaves on
  surgical scenes**, which determines whether MobileSAM in our v1 is viable
  or whether we need MedSAM/SurgicalSAM. Found via GazeSAM references.
- **Spotted in**: GazeSAM NeurIPS 2023 references (cited there for SAM's
  zero-shot generalisation question).

### C.5 SAM-Track / generic video SAM
- **Status**: ⏳ not yet surveyed

### C.6 SAM-Med2D (Cheng et al. 2023, arXiv:2308.16184)
- **Status**: ⏳ not yet surveyed
- **Why relevant**: explicitly cited by GazeSAM as a future-work direction for
  medical-domain SAM fine-tuning. Drop-in candidate for our [src/sam.ts](src/sam.ts).

---

## Cluster D — Surgical eye tracking + annotation tooling (non-gaze-prompted-SAM)

### D.1 Wisely et al. — ophthalmic surgery gaze platform
- **Source**: PMC9898791 ("A Platform for Tracking Surgeon and Observer Gaze
  as a Surrogate for Attention in Ophthalmic Surgery")
- **Stack**: **Tobii 4C** hardware tracker (also claimed hardware-agnostic),
  15.6" monitor, Python + OpenCV + YOLACT + OBS Studio. **Not webcam, not
  browser.**
- **Domain**: *recorded* ophthalmic surgery videos (cataract, vitreoretinal),
  not live OR.
- **User study**: **11 ophthalmic surgeons** (3 attendings ~24.8 yr exp,
  5 clinical fellows ~4.8 yr, 3 residents ~1 yr). Found attendings have
  lower total cartesian distance traveled vs. residents (P < 0.02).
- **Differentiation**:
  - We use **webcam in browser**, no hardware tracker, no Python install
  - We add **interactive annotation (gaze + SAM prompting)** — their platform
    is pure attention recording, not annotation tooling
  - We add **audio commentary** for naturalistic think-aloud
- **Status**: ✅ surveyed
- **Note**: this is **a strong comparison anchor** — same problem domain
  (surgical video + experience-stratified observers), exact opposite stack
  (hardware vs. browser).

### D.2 Wu et al. 2020 — robotic surgery workload via eye tracking
- **Source**: PMC7672675 ("Eye-Tracking Metrics Predict Perceived Workload
  in Robotic Surgical Skills Training")
- **Stack**: **Tobii Pro Glasses 2** (wearable, ~$10k+).
- **Domain**: robotic surgical skills training; gaze entropy + pupil diameter
  as workload proxies.
- **Differentiation**: workload measurement, not annotation; wearable, not
  remote/webcam.
- **Status**: ✅ surveyed
- **Why cited**: standard background for surgical-gaze-as-cognitive-load.

### D.3 EgoSurgery-Phase (2024)
- **Source**: arXiv:2405.19644
- **Scope**: 15 hours of real **open** surgery video recorded with an
  **egocentric** (head-worn) camera, including eye-gaze data, 9 phase labels.
- **Model**: gaze-guided masked autoencoder (GGMAE).
- **Differentiation**: dataset + model, not an annotation tool. Egocentric
  surgeon-worn camera vs. remote reviewer webcam.
- **Status**: ✅ surveyed
- **Why cited**: relevant for "phase recognition" future-work direction in §4.7.

### D.4 Human Gaze Guided Attention for Surgical Activity Recognition (2022)
- **Source**: arXiv:2203.04752
- **Scope**: I3D-based model using human gaze as attention supervision for
  surgical activity recognition on JIGSAWS suturing dataset; 85.4% accuracy.
- **Differentiation**: a model paper, not a tool/system paper. Doesn't
  produce annotations; consumes them.
- **Status**: ✅ surveyed
- **Why cited**: positions gaze as supervision signal — supports our claim
  that captured gaze has downstream model-training value.

### D.5 GazeCode (Benjamins et al.)
- **Repo**: https://github.com/jsbenjamins/gazecode
- **Scope**: open-source toolbox for **manual** classification of mobile
  eye-tracking data. Supports Pupil Labs / SMI / Positive Science / Tobii
  Pro Glasses imports.
- **Differentiation**: post-hoc analysis of recorded mobile-ET sessions, not
  in-the-loop annotation. No webcam, no in-browser, no SAM.
- **Status**: ✅ surveyed
- **Why cited**: relevant prior art in the "open-source gaze annotation"
  space; positions our tool as integrated capture + annotation vs. their
  post-hoc analysis.

### D.6 Gazealytics
- **Source**: arXiv:2303.17202
- **Scope**: open-source gaze analytics visualization toolkit. Not
  surgical-specific.
- **Differentiation**: visualization toolkit only; no capture, no AI prompt
  integration.
- **Status**: ✅ surveyed
- **Why cited**: shows tooling around fixation/AOI is well-established;
  our novelty is the integration + capture in browser.

### D.7 (placeholder — general image annotation tools)
- CVAT, RIL-Contour, ITK-SNAP, ELAN: ⏳ to survey for completeness, briefly,
  as the non-gaze baseline category.

---

## Cluster summary table

| Work | Webcam? | Browser? | Medical? | Video? | Multimodal? | Tool? | Multi-rater? |
|---|---|---|---|---|---|---|---|
| **TurkerGaze** (2015) | ✅ webcamjs | ✅ JS | ❌ saliency | ❌ stills | ❌ | ✅ game | ✅ AMT crowd |
| WebGazer (2016) | ✅ | ✅ | ❌ | n/a | ❌ | (library) | n/a |
| Gaze2Segment (2016) | ❌ | ❌ | ✅ CT | ❌ | ❌ | ⏳ | ⏳ |
| Khosravan c-CAD (2019) | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ CAD | ⏳ |
| GazeSAM (NeurIPS-w 2023) | ❌ Tobii | ❌ PyQt | ✅ radiology | ❌ stills + slices | ❌ | ✅ | ❌ N=1 |
| **GazeMedSeg** (MICCAI 2024) | ❌ EyeLink | ❌ Python | ✅ polyp + prostate | ❌ stills | ❌ | ❌ method+data | ✅ |
| Gaze-Assisted MedSeg (2024) | ⏳ | ❌ | ✅ CT | ❌ | ❌ | ❌ method | ⏳ |
| Zero-Shot Gaze MedSAM-2 (2025) | ⏳ | ❌ | ✅ 3D | ❌ | ❌ | ❌ method | ⏳ |
| Wisely (PMC9898791) | ❌ Tobii 4C | ❌ Python | ✅ ophth | ✅ recorded | ❌ | (attention) | ✅ N=11 |
| Wu 2020 | ❌ Tobii Glasses | ❌ | ✅ robotic train | ✅ live | ❌ | (workload) | ✅ |
| EgoSurgery-Phase (2024) | ❌ egocentric | ❌ | ✅ surgical | ✅ | ❌ | (dataset+model) | n/a |
| Gaze Guided Attn. (2022) | ❌ | ❌ | ✅ JIGSAWS | ✅ | ❌ | (model) | n/a |
| GazeCode | ❌ mobile ET | ❌ desktop | ❌ | ✅ video coding | ❌ | ✅ post-hoc | n/a |
| **Ours (planned)** | **✅** | **✅** | **✅ surgical** | **✅ video** | **✅ +audio** | **✅** | **planned ≥3 + TLX** |

**Defensible "first" claims** (each must be qualified, never used unqualified):
1. **First webcam + browser** gaze annotation **for medical/surgical imaging**
   (TurkerGaze is natural-image saliency; GazeSAM / GazeMedSeg / etc. use
   lab-grade trackers)
2. **First gaze + SAM annotation tool for surgical *video*** (others all do
   still images or volume slices)
3. **First multimodal (gaze + audio + segmentation)** annotation tool in any
   medical context
4. **First multi-participant + NASA-TLX evaluation** of a gaze-prompted-SAM
   tool (GazeSAM N=1, GazeMedSeg's evaluation is about model performance not
   tool usability)

**Avoid**: "first webcam gaze annotation" (TurkerGaze owns 2015); "first
gaze for medical segmentation" (Gaze2Segment 2016 / GazeSAM 2023 / GazeMedSeg
2024); "first SAM-based medical annotation tool" (GazeSAM owns this).

---

## Open survey questions

- [x] ~~Read NeurIPS 2023 GazeSAM PDF~~ → ✅ done; numbers extracted into A.2
- [ ] Read Khosravan et al. 2019 c-CAD paper (A.3)
- [ ] Read An Wang 2023 "SAM Meets Robotic Surgery" (C.4) — tells us how SAM
      behaves on surgical imagery
- [ ] Find post-2024 GazeSAM extensions or webcam-based variants
- [ ] Cluster C: survey MedSAM / SurgicalSAM / SurgSAM-2 / SAM-Med2D in detail
- [ ] Cluster D.7: spot-check CVAT and 1–2 medical annotation tools for
      baseline comparison
- [ ] Confirm no medical / surgical paper has actually deployed WebGazer.js
      (current search says no; double-check via Google Scholar with
      "WebGazer surgical" / "WebGazer clinical")
