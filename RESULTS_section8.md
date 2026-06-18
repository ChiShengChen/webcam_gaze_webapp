# §8 Downstream Utility — Experiment Log & Results (Kvasir-SEG polyp segmentation)

**Status: negative / hardware-barrier result (this is the intended, well-supported finding).**
**One-line takeaway:** under an *identical* weakly-supervised segmentation pipeline,
**expert EyeLink-1000 gaze → test Dice 0.679**, **commodity webcam gaze → test Dice ≈ 0.000**.
The webcam tracker's fixation accuracy (median 17% of fixations inside the polyp, vs
EyeLink's 90%) is too low to serve as a usable weak label for this task.

> This file is a self-contained record for the paper-writing pass. All numbers below were
> measured directly on the machine that ran the experiment (RTX 3090, CUDA). Nothing here is
> estimated. Caveats and confounds are stated explicitly in §6.

---

## 1. Question

Can our honest commodity-**webcam** gaze tracker (FaceMesh + KRR) substitute for an expensive
EyeLink-1000 as the *weak label* in GazeMedSeg's weakly-supervised polyp-segmentation pipeline?
We change **exactly one thing** — the gaze source — and measure the downstream test Dice.

## 2. Setup (identical for both conditions)

| Item | Value |
|---|---|
| Pipeline | GazeMedSeg (Zhong et al., MICCAI 2024), unmodified except the `torch.load` patch in §7 |
| Dataset | Kvasir-SEG, official 900 train / 100 test split (`train.txt` / `test.txt`) |
| Weak label → mask | per-image fixations → Gaussian heatmap (σ=70) → hierarchical-threshold + dense-CRF |
| Levels | `num_levels=2`; level-1 binarize thr=0.5, level-2 thr=0.3 (both `compat=1`) — `KVASIR_LEVEL_CONFIGS[2]` |
| Model | 2-level ensemble of from-scratch 2D U-Nets (`monai BasicUNet`), 224², in_ch=3 |
| Optim | SGD, lr 1e-2 → 1e-4 cosine, weight_decay 4e-4, **batch size 4**, 15 000 iters, seed 0 |
| Eval metric | mean test Dice (`mdice`) vs ground-truth masks; combined pred = mean of the two level logits, thresholded |
| Hardware / env | NVIDIA RTX 3090 (24 GB); conda env `pytorch291`, torch 2.9.1+cu128, monai |

**Batch size note (confound):** the paper uses `bs=8`; we used `bs=4` as a VRAM concession
(the level-2 feature-propagation einsum is the memory hog at 224²). This applies **equally to
both conditions**, so the *EyeLink-vs-webcam contrast* is clean; only the absolute EyeLink
number is not a 1:1 reproduction of the paper (see §6).

## 3. Conditions

- **Control (EyeLink):** GazeMedSeg's released expert EyeLink-1000 fixations
  (`reference/eyelink_kvasir_fixation.csv`).
- **Treatment (Webcam):** our webcam fixations in the identical CSV schema
  (`webcam_gaze/kvasir_fixation_webcam.csv`), dropped into the same pipeline.

Pseudo-masks for each condition were generated into separate folders and each used in turn as
the active `crf_compat1` training input:
`data/Kvasir-SEG/gaze/crf_compat1_eyelink/` and `…/crf_compat1_webcam/`.

## 4. Results

### 4.1 Headline — downstream test Dice (15 000 iters, completed)

| Condition | test Dice (`mdice`) | mIoU | level-1 Dice | level-2 Dice |
|---|---|---|---|---|
| **EyeLink (control)** | **0.679** | 0.554 | 0.669 | 0.681 |
| **Webcam (ours)**     | **≈ 0.000** | ≈ 0.000 | 0.000 | 0.077 |

Webcam `mdice` was **0.000 at every validation checkpoint** (ite 1k–14k) and 1.4e-5 at ite 15k.
EyeLink trained normally and improved monotonically (0.55 @10k → 0.65 @14k → **0.679 @15k**).
**Training loss was healthy and near-identical in both runs (≈ −5.4)** — i.e. the webcam model
*did* fit its pseudo-masks; it simply learned the wrong region.

### 4.2 Why webcam collapses — weak-label quality (the mechanism)

**(a) Pseudo-mask vs ground-truth overlap** (Dice of the generated training mask against the
true polyp mask, full 900-image train set):

| Condition | level-1 mask vs GT | level-2 mask vs GT |
|---|---|---|
| **EyeLink** | **0.753 ± 0.141** | **0.784 ± 0.128** |
| **Webcam**  | **0.120 ± 0.162** | **0.169 ± 0.195** |

The webcam weak labels overlap the actual polyps at Dice ≈ 0.12–0.17 — i.e. they mostly mark
the *wrong* pixels. This is the training ceiling, and it is already near-useless. (36 of 900
train images produced **no** webcam mask at all — no fixations / empty CRF — and were absent
from training; EyeLink: 0 missing.)

**(b) Gaze localization** (fixation accuracy vs polyp, all images):

| Condition | mean \|offset\|† | offset std (dx / dy)† | fixations inside polyp (mean / median) |
|---|---|---|---|
| **EyeLink** | 0.041 | 0.029 / 0.036 | 0.85 / **0.90** |
| **Webcam**  | 0.267 | 0.211 / 0.189 | 0.32 / **0.17** |

†normalized to image dimensions (1.0 = full width/height).

- **Small systematic bias:** webcam fixations sit ~10% of image width left of the polyp
  centroid (dx = −0.10). Correctable in principle, but minor.
- **Dominant random scatter:** webcam offset std ≈ 0.21 — **~7× EyeLink's 0.03**. Even after
  removing the systematic bias, the per-image scatter (~20% of the image) is large relative to
  polyp size, so the heatmap+CRF mask lands off-target on most images. Median fixation-in-polyp
  of **17%** (vs EyeLink 90%) is the crux.

### 4.3 Mechanism of the exact-zero (not just "low")

Webcam level-1 foreground is sparse (~3.7%) **and** mostly off-target, so the level-1 head
collapses to predicting all-background (level-1 Dice = 0.000 from the first validation onward).
The combined prediction is the **mean of the two level logits**, so the dead, strongly-negative
level-1 logits drag the combined map below threshold even where level-2 is weakly positive →
combined `mdice` ≈ 0. (Level-2 alone retains a residual 0.077, near its own 0.17 mask ceiling.)
This is why the result is ~0 rather than merely "below EyeLink."

## 5. Interpretation for §8

Report as a **commodity-webcam vs lab-tracker hardware-barrier / utility result, not parity**:

> Holding the entire weakly-supervised pipeline fixed and swapping only the gaze source,
> expert EyeLink-1000 gaze yields a usable downstream segmenter (test Dice 0.68), whereas our
> commodity webcam gaze does not (≈ 0). The gap traces directly to fixation accuracy: webcam
> fixations land inside the target polyp only 17% of the time (median) versus 90% for EyeLink,
> producing weak-label masks that overlap ground truth at Dice 0.12–0.17 versus 0.75–0.78. At
> the spatial precision this segmentation task demands, a ~$40 webcam tracker with 6–10° error
> is insufficient as a weak-annotation source — a hardware-barrier finding, not an engine
> ranking or a parity claim.

This is consistent with the §8 localization pilot (webcam peak-in-polyp ~32%).

## 6. Caveats / confounds (state these in the paper)

1. **Batch size 4, not the paper's 8** (VRAM concession). Applies to both arms, so the contrast
   is fair, but our **EyeLink control (0.679) is below the paper's reported EyeLink 0.778** and
   is therefore an *internal upper-bound control*, **not** a reproduction of their number.
   Likely causes: bs=4 vs 8 and single seed (seed 0).
2. **Single non-expert annotator on webcam vs a trained annotator on EyeLink.** Annotator skill
   and hardware are confounded; a same-annotator paired collection would require the EyeLink we
   do not assume access to. The webcam result is therefore a lower bound on the hardware effect.
3. **36/900 webcam train images had no usable fixations/mask** (absent from training); EyeLink
   had full coverage. Minor, and in the same direction (favours EyeLink slightly).
4. Pseudo-mask-vs-GT Dice (§4.2a) is measured on the binarized training masks at the exact
   thresholds the pipeline uses; gaze stats (§4.2b) are duration-weighted per-image centroids.
   Both computed over the full available image sets.
5. Reference EyeLink numbers (full-mask 82.12 / EyeLink 77.80 / bbox 73.33 / points 73.05) are
   the paper's, at their bs=8; our 0.679 is the bs=4 in-house control.

## 7. Reproducibility notes

- **One code patch was required.** GazeMedSeg's `torch.load` calls fail under torch ≥ 2.6
  (default `weights_only=True`) when resuming/loading a checkpoint containing numpy scalars.
  Patched both sites in `trainers/base.py` (`resume_configure`, `load`) to
  `torch.load(..., weights_only=False)` (trusted local checkpoints).
- Training command (per condition; set the active `crf_compat1` to the matching gaze masks first):
  ```bash
  PYTORCH_ALLOC_CONF=expandable_segments:True python run.py \
    -m gaze_sup --data kvasir --model unet -bs 4 \
    --exp_path ./exp --root "$DATA_ROOT" \
    --spatial_size 224 --in_channels 3 --opt sgd --lr 1e-2 --lr_min 1e-4 \
    --lr_scheduler cos --max_ite 15000 --num_levels 2 --cons_mode prop \
    --cons_weight 3 --data_size_rate 1 --device 0 --seed 0 --num_worker 4
  ```
- Read result: `grep -hiE 'mdice' <exp_dir>/*.log | tail`.
- Artifacts on the experiment machine (`gms_handoff/GazeMedSeg/`):
  - EyeLink run (resumed to 15k): `exp_eyelink/0/kvasir/..._resume_20260618-202111/` (`model_best.pth`, `mdice=0.679`)
  - Webcam run: `exp/0/kvasir/gaze_sup_..._20260618-121035/` (`mdice≈0`)

## 8. Numbers table (copy-ready for the paper)

| Weak-label source | Fix-in-polyp (median) | Pseudo-mask vs GT Dice (L1/L2) | Downstream test Dice |
|---|---|---|---|
| EyeLink-1000 (control, in-house, bs=4) | 0.90 | 0.75 / 0.78 | **0.679** |
| Commodity webcam (ours, bs=4) | 0.17 | 0.12 / 0.17 | **≈ 0.000** |
| *Paper reference (EyeLink, bs=8)* | — | — | *0.778* |
| *Paper reference (full-mask upper bound)* | — | — | *0.821* |
